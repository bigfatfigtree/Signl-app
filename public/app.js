// SIGNL app (app.joinsignl.com). Single-page client for the SIGNL API.
"use strict";

// Google Analytics 4 (Jeff, 2026-10-21): the same property as the
// marketing site (G-0V1YPFCTSD), loaded by this single shared entry
// so every app view is measured, signed in or not.
var GA_ID = "G-0V1YPFCTSD";
if (GA_ID) {
  var gaScript = document.createElement("script");
  gaScript.async = true;
  gaScript.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(gaScript);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag("js", new Date());
  gtag("config", GA_ID);
}
function trackEvent(name, params) { if (window.gtag) gtag("event", name, params || {}); }

const state = {
  user: null,
  boot: null, // markets, tiers, categories, plans
  joinMode: "quick", // two-step claim: "quick" (default) or "full"
  view: "home",
  tab: null,
  prefill: null, // claim-link prefill: sanitized ?handle=&market=&tier=
  bizPrefill: null, // business-wave prefill: sanitized ?biz=&market=&category=
  publicHandle: null, // set when the URL is /c/<handle>
  resetToken: "", // password reset token from a /?reset= email link
  preview: null, // admin Business Preview session (see enterPreview)
  agentQueue: null, // overhaul Stage 1: Ready-for-you queue the current home computed ({count, title, rows:[{text, sub, btn, act}], empty})
  discover: [],
  threads: [],
  activeThread: null, // other user id
  counterCode: "",
  badges: null, // tab badge counts from GET /notifications (UX redesign section 2)
  offerDraft: {}, // offer composer form state: survives re-renders, cleared on a successful submit
  staff: null, // live staff session info (GET /staff/session) while in staff mode
  staffCode: "", // business staff code from a /redeem/<code> register link
  staffBizName: "", // business name resolved for the PIN screen
};

const app = document.getElementById("app");
const topnav = document.getElementById("topnav");
const bottomnav = document.getElementById("bottomnav");
const PAID_COMP = "Paid cash campaigns";

// Realtor layer (Jeff, 2026-10-22): one profession value carries
// product behavior. It must match REALTOR_PROFESSION in the
// server's markets.js exactly; the server is authoritative (it
// sanitizes against its own list and gates the public payload).
const REALTOR_PROFESSION = "Real estate agent";
function isRealtorProfile(c) {
  return !!c && c.profession === REALTOR_PROFESSION;
}
function professionOptionsHtml(selected) {
  const list = (state.boot && state.boot.professions) || [];
  return `<option value="">Select one (optional)</option>` + list.map((x) => `<option value="${esc(x)}" ${x === selected ? "selected" : ""}>${esc(x)}</option>`).join("");
}
function syncRealtorFields() {
  const block = document.getElementById("p-realtor-block");
  const sel = document.getElementById("p-profession");
  if (block && sel) block.style.display = sel.value === REALTOR_PROFESSION ? "" : "none";
  return false;
}

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch (e) {
    // A network failure says so in plain words, never as a raw
    // status or a browser exception string.
    throw new Error("We could not reach SIGNL. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Server messages are plain language and pass through. A bare
    // failure with no message becomes a friendly one: nobody should
    // ever see "Request failed (502)" (UX audit fix, 2026-10-22).
    // The parsed body rides along on the error so callers that need
    // structured fields (the offer dedupe's existingOfferId) can
    // read them without a second request.
    const e = new Error(data.error || "Something went wrong on our side. Try again in a moment.");
    e.data = data;
    e.status = res.status;
    throw e;
  }
  return data;
}

// Skeleton loading state (visual experience pass, 2026-10-24):
// shimmer cards while a surface loads, with the old loading text
// kept for screen readers. Purely presentational.
function skelHtml(label, n) {
  return `<div class="skel-wrap" role="status"><span class="sr-only">${esc(label)}</span>${'<div class="skel skel-card"><div class="skel-line med" style="margin-top:22px"></div><div class="skel-line"></div><div class="skel-line short"></div></div>'.repeat(n || 2)}</div>`;
}

// Business initial chip (visual experience pass): offer feeds have
// no business photography in the data model, so cards lead with a
// compact gradient monogram chip built from the business name
// (existing data) instead of a bare text header.
function bizChipHtml(name) {
  const initial = (String(name || "?").trim().charAt(0) || "?").toUpperCase();
  return `<span class="avatar-initial" style="width:42px;height:42px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:1.02rem;flex:none" aria-hidden="true">${esc(initial)}</span>`;
}

// Success check SVG (visual experience pass): drawn once by CSS
// animation inside .success-check-wrap. Shared by the redemption
// and proof-submission success moments.
function successCheckHtml() {
  return `<div class="success-check-wrap"><svg class="success-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"></circle><path d="M15 27l7.5 7.5L37 19"></path></svg></div>`;
}

// Submit state (UX audit fix, 2026-10-22): one shared helper so a
// slow connection never invites a double-tap. The first call
// disables the form's submit button and swaps its label to
// "Working..."; the second restores both. Returns false when the
// form is already busy, so handlers can bail on re-entry.
function submitBusy(form, busy) {
  if (!form || !form.querySelector) return true;
  const btn = form.querySelector('button[type="submit"]');
  if (!btn) return true;
  if (busy) {
    if (btn.dataset.busy) return false;
    btn.dataset.busy = "1";
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Working...";
    return true;
  }
  delete btn.dataset.busy;
  btn.disabled = false;
  if (btn.dataset.label) btn.textContent = btn.dataset.label;
  return true;
}

// Creator referral (Jeff, 2026-10-18): a visitor who arrived through
// a creator's invite link (?ref=<handle>) carries that credit through
// to their registration, so the inviting creator is credited.
function storedRef() {
  try { return localStorage.getItem("signl_ref") || ""; } catch (e) { return ""; }
}

// Signup source (Jeff, 2026-10-21): segment and channel pages tag
// their claim links with ?src= (moms, students, linkedin, learn).
// It is persisted exactly like the referral credit and sent at
// registration, so each applicant's origin page is on the record.
function storedSrc() {
  try { return localStorage.getItem("signl_src") || ""; } catch (e) { return ""; }
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

// Mirror of the server's normalizeHandle (Jeff, 2026-10-26): a
// handle typed as @name or pasted as a full profile link becomes
// the same clean handle before anything is sent, and the form
// writes the clean value back so the creator sees what was
// understood. The server normalizes again on arrival; the two
// must stay in step.
function normalizeHandleClient(raw) {
  let h = String(raw == null ? "" : raw).trim();
  if (!h) return "";
  if (h.includes("/")) {
    h = h.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    const parts = h.split(/[/?#]/).map((x) => x.trim()).filter(Boolean);
    h = parts.length ? parts[parts.length - 1] : "";
  }
  return h.replace(/^@/, "").trim();
}

function parseClaimParams(params) {
  const out = {};
  const handle = sanitizeClaimHandle(params.get("handle"));
  if (handle) out.handle = handle;
  // Claim links may carry &platform=<slug> (Jeff, 2026-10-22): the
  // claim opens with that platform preselected in the picker.
  // Absent or unknown values prefill nothing, and the forms default
  // to Instagram, exactly as every link already sent behaves.
  const platformRaw = String(params.get("platform") || "").trim().toLowerCase();
  if (PRIMARY_PLATFORMS_CLIENT.some((p) => p.id === platformRaw)) out.platform = platformRaw;
  let marketRaw = String(params.get("market") || "").trim().slice(0, 60);
  if (marketRaw === "Hampton Roads") marketRaw = "Virginia Beach";
  if (marketRaw && state.boot) {
    const m = state.boot.markets.find((x) => x.name === marketRaw || x.id === marketRaw);
    if (m) out.market = m.name;
    else if (marketRaw === unlistedLabel()) out.market = marketRaw;
  }
  const tierRaw = String(params.get("tier") || "").trim().slice(0, 20);
  if (tierRaw && state.boot && state.boot.tiers.some((t) => t.id === tierRaw)) out.tier = tierRaw;
  return out;
}

// Business-wave prefill (Jeff, 2026-10-23): the founding
// business wave email carries a prebuilt link per business,
// ?biz=<name>&market=<name>&category=<app category>&src=business-wave.
// Same discipline as the claim prefill: values only FILL the
// founding registration form, anything that does not exactly
// match the published market and category lists is silently
// ignored, and nothing ever auto-submits. The src is persisted
// by the generic ?src= handling in init, so the created record
// carries signupSource "business-wave" with no extra plumbing.
function parseBizParams(params) {
  const out = {};
  const biz = String(params.get("biz") || "").trim().slice(0, 120);
  if (biz) out.businessName = biz;
  let marketRaw = String(params.get("market") || "").trim().slice(0, 60);
  if (marketRaw === "Hampton Roads") marketRaw = "Virginia Beach";
  if (marketRaw && state.boot) {
    const m = state.boot.markets.find((x) => x.name === marketRaw || x.id === marketRaw);
    if (m) out.market = m.name;
  }
  const catRaw = String(params.get("category") || "").trim().slice(0, 60);
  if (catRaw && state.boot && state.boot.businessCategories.includes(catRaw)) out.category = catRaw;
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

// Share shell for /c/ profiles (UX audit fix, 2026-10-22): the
// profile page sets its own document title and Open Graph /
// Twitter meta from the loaded profile, so a link the creator
// pastes into Messages, WhatsApp, or their bio unfurls as their
// name, photo, and market instead of a generic SIGNL card. Since
// Jeff's 2026-10-23 ruling, approved + profile-complete profiles
// ALSO get this meta server-rendered with index,follow (the
// cpage route in the router); this client shell remains the
// in-app fallback and keeps SPA navigation consistent.
const DEFAULT_PAGE_TITLE = "SIGNL - Local Creator Marketing Platform";
function setShareMeta(key, attr, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"][data-signl-meta]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.setAttribute("data-signl-meta", "1");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}
function setShareCanonical(href) {
  // The server-rendered /c/ page already carries a canonical; the
  // in-app shell just keeps it pointing at the profile on screen
  // (and adds one, marked for cleanup, on shells served without).
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    el.setAttribute("data-signl-meta", "1");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}
function applyProfileShareShell(p, place) {
  document.title = `${p.name} (@${p.handle}) on SIGNL${place ? ` | ${place}` : ""}`;
  const desc = `${p.name} is a founding creator on SIGNL in ${place || "their market"}${p.tierBand ? ` (${p.tierBand} tier)` : ""}.${typeof p.localAudiencePct === "number" ? ` ${p.localAudiencePct}% of their audience is local.` : ""} Local businesses comp creators for honest posts.`;
  setShareCanonical(`https://app.joinsignl.com/c/${p.handle}`);
  setShareMeta("og:title", "property", document.title);
  setShareMeta("og:description", "property", desc);
  setShareMeta("og:type", "property", "profile");
  if (p.photoUrl) setShareMeta("og:image", "property", p.photoUrl.startsWith("http") ? p.photoUrl : `https://app.joinsignl.com${p.photoUrl}`);
  setShareMeta("twitter:card", "name", p.photoUrl ? "summary_large_image" : "summary");
  setShareMeta("twitter:title", "name", document.title);
  setShareMeta("twitter:description", "name", desc);
  if (p.photoUrl) setShareMeta("twitter:image", "name", p.photoUrl.startsWith("http") ? p.photoUrl : `https://app.joinsignl.com${p.photoUrl}`);
}
function clearShareShell() {
  document.title = DEFAULT_PAGE_TITLE;
  document.head.querySelectorAll("meta[data-signl-meta], link[data-signl-meta]").forEach((el) => el.remove());
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
    document.title = "Profile not public | SIGNL";
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
  const place = p.unlisted ? esc(p.city) : esc(marketDisplayName(p.market));
  applyProfileShareShell(p, p.unlisted ? (p.city || "") : (p.market || ""));
  const initial = esc((p.name || "?").trim().charAt(0).toUpperCase() || "?");
  app.innerHTML = `
  <div style="max-width:720px;margin:20px auto">
    <div class="creator-card full">
      <div class="cc-photo${p.photoUrl ? "" : " no-photo"}">
        ${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="">` : `<div class="cc-mono"><span>${initial}</span></div>`}
        ${p.tierBand ? `<span class="cc-tier">${esc(p.tierBand)}</span>` : ""}
        ${p.paidRate ? `<span class="cc-paid">Paid bookings: $${fmtPrice(p.paidRate)}</span>` : ""}${p.licensingFee ? ` <span class="cc-paid">Licenses posts: $${fmtPrice(p.licensingFee)}</span>` : ""}
      </div>
      ${galleryRowHtml(p.photos)}
      <div class="cc-body">
        <div class="cc-id">
          <div class="cc-name">${esc(p.name)}</div>
          ${ccHandleHtml(p)}
          <div class="cc-chips">
            <span class="cc-chip market">${place}</span>
            ${!p.unlisted && p.city ? `<span class="cc-chip">${esc(p.city)}</span>` : ""}
            ${p.neighborhood ? `<span class="cc-chip">${esc(p.neighborhood)}</span>` : ""}
            ${p.campusBadge ? `<span class="cc-chip">${esc(p.campusBadge)}</span>` : ""}
            ${p.isRealtor ? `<span class="cc-chip">Realtor</span>` : ""}
            <span class="cc-chip">Founding Creator</span>
            ${p.foundingBand ? `<span class="cc-chip">First ${p.foundingBand} founding</span>` : ""}
          </div>
        </div>
        <p>${scoreBadge(p.localImpactScore)}${p.momentumPoints ? ` <span class="badge info">Momentum ${p.momentumPoints} pts</span>` : ""}${badgesHtml(p.badges)}</p>
        <p>${shareBlockHtml(p.handle, p.unlisted ? (p.city || "") : (p.market || ""), "Share", p.name)}</p>
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
    <div class="tint-block" style="margin-top:0">
    ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    ${p.isRealtor && p.farmAreas && p.farmAreas.length ? `<p class="small">Neighborhoods: ${p.farmAreas.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    ${p.compCategories && p.compCategories.length ? `<p class="small muted">Open to comps: ${p.compCategories.map(esc).join(", ")}</p>` : ""}
    <p class="small">${p.paidRate ? `<span class="badge tier">Paid bookings: $${fmtPrice(p.paidRate)}</span> ` : ""}${p.compOpen === false ? `<span class="badge warn">Paid visits only</span>` : `<span class="badge info">Open to comp visits</span>`}</p>
    ${p.paidRate ? `<p class="small muted">Books at $${fmtPrice(p.paidRate)} &middot; creator keeps 97% &middot; held until the post is live.</p>` : ""}${p.licensingFee ? `<p class="small muted">Licenses a comped post for 90 days of repost and ad use at $${fmtPrice(p.licensingFee)} &middot; creator approves each one &middot; keeps 97%.</p>` : ""}
    </div>
    ${bestWorkHtml(p.bestWork)}
    ${trackRecordHtml(p)}
    ${reviewsHtml(p)}
    ${visitIncludesHtml(p.visitIncludes)}
    ${p.isRealtor && p.brokerage ? `<p class="small muted">Brokered by ${esc(p.brokerage)}</p>` : ""}
    <div class="cta-row" style="justify-content:flex-start">
      ${state.user ? `<a class="btn ghost" href="#" onclick="return go('dashboard')">Back to my dashboard</a>` : `<a class="btn" href="#" onclick="return go('join-creator')">Become a Founding Creator</a> <a class="btn ghost" href="#" onclick="return go('for-businesses')">For Businesses</a>`}
    </div>
    </section>
  </div>`;
}

// Listing presentation proof (Jeff, 2026-10-22, realtor layer):
// a print-optimized one-pager at /c/<handle>/proof, rendered from
// the SAME public payload as /c/<handle>, so it can only ever show
// public facts: no email, no account data, nothing private. The
// owner reaches it from the "Listing proof sheet" action on their
// own Profile tab; anyone with the link sees the same public
// facts. Honesty rule (playbook Part 3): every number here is a
// real stored value from the creator's record. A metric that is
// null or gated (rating below 3 businesses) is OMITTED, never
// estimated, projected, or zero-filled into a claim.
async function renderPublicProof() {
  const handle = state.publicHandle || "";
  app.innerHTML = `<section class="panel center" style="max-width:560px;margin:40px auto"><p class="muted">Loading the proof sheet for @${esc(handle)}...</p></section>`;
  let p = null;
  try {
    const data = await api("GET", "/c/" + encodeURIComponent(handle));
    p = data.profile;
  } catch (e) { p = null; }
  if (!p) {
    document.title = "Proof sheet not public | SIGNL";
    app.innerHTML = `
    <section class="panel center" style="max-width:560px;margin:40px auto">
      <h2>Proof sheet not public</h2>
      <p class="muted">There is no public SIGNL profile at this link yet, so there is no proof sheet to show. Proof sheets exist once a creator is approved and public.</p>
      <div class="cta-row" style="justify-content:center">
        ${state.user ? `<a class="btn" href="#" onclick="return go('dashboard')">Back to my dashboard</a>` : `<a class="btn" href="#" onclick="return go('join-creator')">Become a Founding Creator</a>`}
      </div>
    </section>`;
    return;
  }
  const place = p.unlisted ? (p.city || "") : (p.market || "");
  document.title = `Listing proof: ${p.name} (@${p.handle}) | SIGNL`;
  const initial = esc((p.name || "?").trim().charAt(0).toUpperCase() || "?");
  const tr = p.trackRecord || {};
  const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const statCells = [];
  statCells.push(`<div class="stat-cell"><div class="stat-num">${fmtNum(totalAudienceOf(p))}</div><div class="stat-lbl">Stacked audience, all platforms</div></div>`);
  if (p.localAudiencePct !== null && p.localAudiencePct !== undefined) {
    statCells.push(`<div class="stat-cell"><div class="stat-num">${p.localAudiencePct}%</div><div class="stat-lbl">Local reach (${esc(p.localAudienceSource || "Self-reported")})</div></div>`);
  }
  if (typeof p.momentumPoints === "number") {
    statCells.push(`<div class="stat-cell"><div class="stat-num">${p.momentumPoints}</div><div class="stat-lbl">Momentum points (reliability and referrals)</div></div>`);
  }
  if (p.ratingCount >= 3 && p.ratingAvg !== null && p.ratingAvg !== undefined) {
    statCells.push(`<div class="stat-cell"><div class="stat-num">${esc(String(p.ratingAvg))} / 5</div><div class="stat-lbl">Rating from ${p.ratingCount} businesses</div></div>`);
  }
  if (tr.postsDelivered > 0) {
    statCells.push(`<div class="stat-cell"><div class="stat-num">${tr.postsDelivered}</div><div class="stat-lbl">Posts delivered on SIGNL</div></div>`);
  }
  if (tr.visitsCompleted > 0) {
    statCells.push(`<div class="stat-cell"><div class="stat-num">${tr.visitsCompleted}</div><div class="stat-lbl">Visits completed</div></div>`);
  }
  if (tr.postsDelivered > 0 && tr.onTimePct !== null && tr.onTimePct !== undefined) {
    statCells.push(`<div class="stat-cell"><div class="stat-num">${tr.onTimePct}%</div><div class="stat-lbl">Posts on time</div></div>`);
  }
  app.innerHTML = `
  <div class="proof-sheet">
    <div class="proof-head">
      ${p.photoUrl ? `<img class="proof-photo" src="${esc(p.photoUrl)}" alt="">` : `<div class="proof-mono"><span>${initial}</span></div>`}
      <div class="proof-id">
        <div class="proof-name">${esc(p.name)}</div>
        <div class="proof-handle">@${esc(p.handle)} &middot; ${esc(p.primaryPlatformLabel || "Instagram")}</div>
        <div class="proof-place">${esc(place)}${p.city && !p.unlisted ? ` &middot; ${esc(p.city)}` : ""}${p.neighborhood ? ` &middot; ${esc(p.neighborhood)}` : ""}</div>
        <div class="cc-chips" style="margin-top:8px">
          ${p.tierBand ? `<span class="cc-chip">${esc(p.tierBand)}</span>` : ""}
          ${p.isRealtor ? `<span class="cc-chip">Realtor</span>` : ""}
          <span class="cc-chip">Founding Creator</span>
        </div>
      </div>
      <div class="proof-brand">SIGNL</div>
    </div>
    ${p.isRealtor && p.farmAreas && p.farmAreas.length ? `<p class="proof-hoods">Neighborhoods: ${p.farmAreas.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    <div class="stat-band proof-stats">${statCells.join("")}</div>
    ${tr.businessesWorkedWith && tr.businessesWorkedWith.length ? `<p class="proof-biz">Businesses posted for: ${tr.businessesWorkedWith.map(esc).join(", ")}</p>` : ""}
    ${p.isRealtor && p.brokerage ? `<p class="proof-brokerage">Brokered by ${esc(p.brokerage)}</p>` : ""}
    <div class="proof-foot">
      <p>Activity verified by SIGNL &middot; Generated ${esc(generated)}</p>
      <p class="muted">Every figure on this sheet comes from this creator's real SIGNL record: delivered posts, tracked visits, and business ratings. Local audience share is reported by the creator and labeled with its source above. Nothing here is estimated or projected.</p>
    </div>
    <div class="cta-row no-print" style="justify-content:flex-start;margin-top:16px">
      <button class="btn" onclick="window.print()">Print or save as PDF</button>
      <a class="btn ghost" href="/c/${encodeURIComponent(p.handle)}">Back to profile</a>
    </div>
  </div>`;
}

function inviteUrlFor(u) {
  const handle = u && u.creator && u.creator.handle;
  return handle ? `https://app.joinsignl.com/?ref=${encodeURIComponent(handle)}` : "";
}

// One-tap referral sharing (Jeff, 2026-10-21, narrow scope): the
// creator's referral link with a pre-written founding-status line
// naming their market. navigator.share where the platform offers
// it (the mobile share sheet: Instagram, Facebook, messages);
// otherwise a small fallback menu: copy link, Facebook, X,
// WhatsApp. Placed ONLY in the dashboard roster block, the
// founding status (approval) surface, the profile-completion
// moment, and the public /c/ profile (with the profile owner's
// own referral link, so the creator is credited whoever shares).
function displayMarketName(place) {
  return place === "Hampton Roads" ? "Virginia Beach" : place;
}

function sharePayloadFor(place, handle, subjectName) {
  place = displayMarketName(place);
  const url = `https://app.joinsignl.com/?ref=${encodeURIComponent(handle || "")}`;
  const text = subjectName
    ? `${subjectName} is a founding creator on SIGNL in ${place}. Local businesses comp creators for honest posts, and it is free for creators. Claim your spot:`
    : `I just became a founding creator on SIGNL in ${place}. Local businesses comp creators for honest posts, and it is free for creators. Claim your spot:`;
  return { title: "SIGNL", text, url };
}

function shareBlockHtml(handle, place, label, subjectName) {
  if (!handle) return "";
  const payload = sharePayloadFor(place, handle, subjectName);
  const full = `${payload.text} ${payload.url}`;
  return `<span class="share-wrap"><button type="button" class="btn small-btn ghost" data-share-handle="${esc(handle)}" data-share-place="${esc(displayMarketName(place) || "")}"${subjectName ? ` data-share-name="${esc(subjectName)}"` : ""} onclick="return shareInvite(this)">${esc(label || "Share your invite")}</button><span class="share-menu" style="display:none"> <a href="#" onclick="return copyShareLink(this)">Copy link</a> &middot; <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(payload.url)}" target="_blank" rel="noopener">Facebook</a> &middot; <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(payload.text)}&url=${encodeURIComponent(payload.url)}" target="_blank" rel="noopener">X</a> &middot; <a href="https://wa.me/?text=${encodeURIComponent(full)}" target="_blank" rel="noopener">WhatsApp</a></span></span>`;
}

function shareInvite(btn) {
  const payload = sharePayloadFor(btn.getAttribute("data-share-place") || "", btn.getAttribute("data-share-handle") || "", btn.getAttribute("data-share-name") || "");
  if (navigator.share) {
    navigator.share(payload).catch(() => {});
    return false;
  }
  const menu = btn.parentElement ? btn.parentElement.querySelector(".share-menu") : null;
  if (menu) menu.style.display = menu.style.display === "block" ? "none" : "block";
  return false;
}

function copyShareLink(a) {
  const wrap = a.closest ? a.closest(".share-wrap") : null;
  const btn = wrap ? wrap.querySelector("[data-share-handle]") : null;
  const url = btn ? sharePayloadFor("", btn.getAttribute("data-share-handle") || "").url : "";
  if (url && navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
  a.textContent = "Copied";
  return false;
}

// University autocomplete (Jeff, 2026-10-21): the bundled IPEDS
// institution dataset (public/data/us-colleges.json, US Dept of
// Education) lazy-loads the first time a form renders the field.
// Typing 2+ characters matches names and aliases; picking a
// result fills the canonical dataset name, and the server
// resolves it (plus city/state) at save. Text with no pick is
// sent as typed and lands as a flagged free entry.
let collegesClientCache = null;
let collegesClientLoading = null;
function loadCollegesClient() {
  if (collegesClientCache) return Promise.resolve(collegesClientCache);
  if (!collegesClientLoading) {
    collegesClientLoading = fetch("/data/us-colleges.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        collegesClientCache = (Array.isArray(list) ? list : []).map((rec) => ({ n: rec.n, a: rec.a || [], c: rec.c, s: rec.s, q: (rec.n + " " + (rec.a || []).join(" ")).toLowerCase() }));
        return collegesClientCache;
      })
      .catch(() => { collegesClientCache = []; return collegesClientCache; });
  }
  return collegesClientLoading;
}

function universityMatches(q) {
  const query = (q || "").trim().toLowerCase();
  if (query.length < 2 || !collegesClientCache) return [];
  const starts = [];
  const subs = [];
  for (const rec of collegesClientCache) {
    if (rec.n.toLowerCase().startsWith(query) || rec.a.some((a) => a.toLowerCase().startsWith(query))) starts.push(rec);
    else if (rec.q.includes(query)) subs.push(rec);
    if (starts.length >= 8) break;
  }
  return starts.concat(subs).slice(0, 8);
}

function setupUniversityAutocomplete(inputId, resultsId) {
  const input = document.getElementById(inputId);
  const box = document.getElementById(resultsId);
  if (!input || !box || input.dataset.uniWired) return;
  input.dataset.uniWired = "1";
  input.setAttribute("autocomplete", "off");
  loadCollegesClient();
  input.addEventListener("input", () => {
    const q = input.value;
    if ((q || "").trim().length < 2) { box.innerHTML = ""; return; }
    loadCollegesClient().then(() => {
      const ms = universityMatches(q);
      box.innerHTML = ms.map((rec, i) => `<button type="button" class="uni-opt" data-uni-i="${i}"><strong>${esc(rec.n)}</strong> <span class="muted">${esc(rec.c)}, ${esc(rec.s)}</span></button>`).join("");
      box.querySelectorAll(".uni-opt").forEach((btn, i) => {
        btn.addEventListener("click", () => {
          input.value = ms[i].n;
          box.innerHTML = "";
        });
      });
    });
  });
  input.addEventListener("blur", () => { setTimeout(() => { box.innerHTML = ""; }, 200); });
}

function universityStatusSuffix(u) {
  // Admin detail helper: " (Current student)" / " (Alumni)" /
  // " (Not a student)" beside the university, empty when unset.
  const s = (u && u.universityStatus) || (u && u.creator && u.creator.universityStatus) || "";
  const label = { current_student: "Current student", alumni: "Alumni", not_student: "Not a student" }[s] || "";
  return label ? ` (${label})` : "";
}

function campusBadgeHtml(source) {
  if (!source) return "";
  let badge = "";
  if (typeof source === "string") badge = source;
  // The server computes the badge under the student-status gate
  // (current students only): when the field is present, even as
  // null, it is the whole answer. Never re-derive it from the
  // university alone, or alumni would get their badge back.
  else if ("campusBadge" in source) badge = source.campusBadge || "";
  else if (source.profile && "campusBadge" in source.profile) badge = source.profile.campusBadge || "";
  else if (source.creator && "campusBadge" in source.creator) badge = source.creator.campusBadge || "";
  return badge ? ` <span class="badge info">${esc(badge)}</span>` : "";
}

function growRosterHtml(u) {
  const link = inviteUrlFor(u);
  if (!link) return "";
  const place = u.market === unlistedLabel() ? (u.city || "your city") : u.market;
  const m = u.momentum || { signups: 0, approved: 0, points: 0 };
  return `
    <div class="panel mt" style="text-align:left">
      <h3 style="margin-top:0">Grow your roster</h3>
      <p class="small">Share your invite link — creators who join through it are credited to you.</p>
      <div class="field"><label>Your invite link</label><input type="text" readonly value="${esc(link)}" onclick="this.select()"></div>
      <p class="small">${shareBlockHtml(u.creator && u.creator.handle, place, "Share your invite")}</p>
      <p class="small"><strong>Your roster:</strong> ${m.signups} ${m.signups === 1 ? "creator" : "creators"} joined through your link &middot; ${m.approved} approved &middot; <strong>${m.points} Momentum points</strong></p>
      ${m.campusCrew ? `<p class="small"><strong>Your campus crew: ${m.campusCrew.count} creator${m.campusCrew.count === 1 ? "" : "s"} from ${esc(m.campusCrew.university)}</strong></p>` : ""}
      <p class="small">Points: +3 per sign-up &middot; +10 per approval. Roster builders get seen first.</p>
      ${ladderHtml(u)}
      <p class="small muted">Tap the link to copy it.</p>
    </div>`;
}

// Two-step claim, step two (Jeff, 2026-10-20): the finish-your-
// profile card. It rides on an approved creator's dashboard until
// the profile is complete: progress over the gate items, every
// item with its Momentum value, and the button into the Profile
// tab where the work happens. Data is the server-computed
// user.profileCompletion payload; nothing here is client math.
function profileCompletionHtml(u) {
  const pc = u && u.profileCompletion;
  if (!pc || pc.complete || u.role !== "creator" || u.status !== "approved") return "";
  const rows = pc.items.map((item) => `
    <div class="earn-row ${item.done ? "done" : ""}">
      <span class="earn-state">${item.done ? "&#10003;" : "+"}</span>
      <span class="earn-label">${esc(item.label)}${item.required && !item.done ? ` <span class="badge info">Needed</span>` : ""}${item.detail ? ` <span class="muted">(${esc(item.detail)})</span>` : ""}</span>
      <span class="earn-points">${item.points ? "+" + item.points + " pts" : ""}</span>
    </div>`).join("");
  return `
  <div class="panel mt tint" style="text-align:left">
    <div class="flex-between"><h3 style="margin:0">Finish your profile to be launch-ready</h3><span class="badge info">${pc.requiredDone} of ${pc.requiredTotal} essentials done</span></div>
    <p class="small">Businesses can't see you until the essentials are done.</p>
    ${rows}
    <div class="mt"><button class="btn" onclick="return go('dashboard','Profile')">Finish my profile</button></div>
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
    <div class="flex-between"><h3 style="margin:0">Momentum points</h3><span class="badge info" style="font-size:1rem;padding:6px 14px">${m.points} points</span></div>
    <p class="small">Earned for on-time posts, a complete profile, reviews and invites.${m.floorApplied ? " Your total never drops below zero." : ""}</p>
    <h4 style="margin:14px 0 6px">Ways to earn</h4>
    ${checklist || `<p class="small muted">Loading...</p>`}
    ${ledger ? `<h4 style="margin:16px 0 6px">Points history</h4>${ledger}` : ""}
    <p class="small muted" style="margin-top:12px">Late post −10 &middot; No-show −25 &middot; Redeemed, never posted −50.</p>
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

// V5 money discipline (Jeff, 2026-10-25): ONE shape everywhere.
// fmtMoney is for computed amounts and caps stated in sentences:
// thousands separators + exactly two decimals ($145.50,
// $1,250.00). fmtPrice is for display prices — listed rates, plan
// prices, big card anchors: clean whole dollars when the value is
// whole ($150), and it falls back to fmtMoney the moment a value
// actually carries cents, so no amount anywhere ever renders
// with a single decimal or a dropped trailing zero again.
function fmtPrice(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "n/a";
  const v = Number(n);
  if (Math.round(v * 100) / 100 === Math.round(v)) return Math.round(v).toLocaleString("en-US");
  return fmtMoney(v);
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
    const labels = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", x: "X", linkedin: "LinkedIn", youtube: "YouTube", snapchat: "Snapchat" };
    return Object.entries(source.audienceStack)
      .filter(([, n]) => Number(n) > 0)
      .map(([platform, count]) => ({ platform, label: labels[platform] || platform, count: Number(count) }))
      .sort((a, b) => b.count - a.count);
  }
  return [];
}

// ---------- primary platform (Jeff, 2026-10-22) ----------
// Signup opens with "Where is your main audience?" and the handle
// is collected for the picked platform. The server stores
// primaryPlatform + primaryProfileUrl on the record and computes
// them into every payload; these helpers only label and preview.
// Records and payloads from before the picker read as Instagram.
const PRIMARY_PLATFORMS_CLIENT = [
  { id: "instagram", label: "Instagram", host: "instagram.com/" },
  { id: "tiktok", label: "TikTok", host: "tiktok.com/@" },
  { id: "youtube", label: "YouTube", host: "youtube.com/@" },
  { id: "facebook", label: "Facebook", host: "facebook.com/" },
  { id: "x", label: "X", host: "x.com/" },
  { id: "linkedin", label: "LinkedIn", host: "linkedin.com/in/" },
];
function primaryMetaClient(id) {
  return PRIMARY_PLATFORMS_CLIENT.find((p) => p.id === id) || PRIMARY_PLATFORMS_CLIENT[0];
}
function primaryLabelClient(id) { return primaryMetaClient(id).label; }
function primaryOptionsHtml(selected) {
  return PRIMARY_PLATFORMS_CLIENT.map((p) => `<option value="${p.id}"${p.id === selected ? " selected" : ""}>${p.label}</option>`).join("");
}

// ---------- V4 form controls: chips / toggles / steppers ----------
// Presentation swaps bound to the SAME underlying field: a chip
// group renders a hidden input carrying the form field's original
// id, and pickChip writes the value into it, then runs the exact
// sync handler the old <select> onchange ran. Field names,
// defaults, validation, submit handlers and payloads are
// unchanged; only the control's face changed.
function chipSelectHtml(id, options, selected, syncName, optional) {
  const sel = selected === undefined || selected === null ? "" : String(selected);
  return `<div class="chiprow" data-chipfor="${esc(id)}"${optional ? ` data-optional="1"` : ""}>${options.map((o) => `<button type="button" class="rchip${String(o.value) === sel ? " on" : ""}" data-val="${esc(String(o.value))}" onclick="pickChip(this,'${esc(id)}'${syncName ? `,'${esc(syncName)}'` : ""})">${esc(o.label)}</button>`).join("")}</div><input type="hidden" id="${esc(id)}" value="${esc(sel)}">`;
}
function platformChipsHtml(id, selected, syncName) {
  return chipSelectHtml(id, PRIMARY_PLATFORMS_CLIENT.map((p) => ({ value: p.id, label: p.label })), selected || "instagram", syncName, false);
}
function professionChipsHtml(id, selected, syncName) {
  const list = (state.boot && state.boot.professions) || [];
  return chipSelectHtml(id, list.map((x) => ({ value: x, label: x })), selected || "", syncName, true);
}
function universityStatusChipsHtml(id, selected) {
  return chipSelectHtml(id, [
    { value: "current_student", label: "Current student" },
    { value: "alumni", label: "Alumni" },
    { value: "not_student", label: "Not a student" },
  ], selected || "", null, true);
}
function pickChip(btn, id, syncName) {
  const input = document.getElementById(id);
  if (!input || !btn) return false;
  const row = btn.closest(".chiprow");
  const val = btn.getAttribute("data-val") || "";
  const optional = row && row.getAttribute("data-optional") === "1";
  const next = optional && input.value === val ? "" : val;
  input.value = next;
  if (row) row.querySelectorAll(".rchip").forEach((b) => b.classList.toggle("on", (b.getAttribute("data-val") || "") === next));
  if (syncName && typeof window[syncName] === "function") window[syncName]();
  return false;
}
// Stepper for small-range numeric inputs: buttons adjust the SAME
// input element and fire its real input/change events, so every
// existing oninput/onchange handler and validation runs as before.
function stepField(id, delta, min, max) {
  const el = document.getElementById(id);
  if (!el) return false;
  let v = parseInt(el.value, 10);
  if (!Number.isFinite(v)) v = (min !== null && min !== undefined ? min : 0) - delta; // empty field: first tap lands on the minimum
  v += delta;
  if (min !== null && min !== undefined) v = Math.max(min, v);
  if (max !== null && max !== undefined) v = Math.min(max, v);
  el.value = String(v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return false;
}

// ---------- V5: drag bars + card stacks (Jeff, 2026-10-25) ----------
// Drag bar: a range slider bound to the SAME number input the V4
// stepper drove. The number input stays the value readout (big,
// borderless) and stays typeable; sliding writes its value and
// dispatches its real input/change events, so validation, draft
// sync and coach logic run exactly as they did with the stepper.
function dragBarHtml(id, min, max, inputAttrs) {
  // inputAttrs carries the field's own value/placeholder/handlers
  // verbatim (oninput/onblur as the stepper-era input had them);
  // dragSync rides along so typing moves the bar. The number
  // input gets no max attribute: typing past the bar's range
  // stays legal, the bar just pins at its end.
  const attrs = String(inputAttrs || "").replace(/oninput="([^"]*)"/, `oninput="$1;dragSync('${id}')"`);
  return `<div class="dragbar"><input type="range" class="drag-range" data-dragfor="${esc(id)}" min="${min}" max="${max}" step="1" aria-label="Drag to set the value" oninput="dragSlide(this)"><span class="drag-val"><input type="number" id="${esc(id)}" min="${min}" ${attrs}></span><span class="drag-minmax"><span>${min}</span><span>${max}</span></span></div>`;
}
function dragSync(id) {
  const num = document.getElementById(id);
  const bar = document.querySelector(`.drag-range[data-dragfor="${id}"]`);
  if (!num || !bar) return;
  let v = parseInt(num.value, 10);
  if (!Number.isFinite(v)) v = parseInt(bar.min, 10) || 0;
  v = Math.max(parseInt(bar.min, 10), Math.min(parseInt(bar.max, 10), v));
  bar.value = String(v);
  const pct = (v - Number(bar.min)) / Math.max(1, Number(bar.max) - Number(bar.min));
  bar.style.setProperty("--fill", (pct * 100).toFixed(1) + "%");
}
function dragSlide(range) {
  const id = range.getAttribute("data-dragfor");
  const num = document.getElementById(id);
  if (!num) return false;
  num.value = range.value;
  dragSync(id);
  // The events the number input's own handlers expect (the same
  // dispatch the V4 stepper performed).
  num.dispatchEvent(new Event("input", { bubbles: true }));
  num.dispatchEvent(new Event("change", { bubbles: true }));
  return false;
}
function dragInit(root) {
  (root || document).querySelectorAll(".drag-range").forEach((r) => dragSync(r.getAttribute("data-dragfor")));
}

// Card stacks (Discover + Offers): one card at a time, pointer
// drag with a slight rotate, spring back under the threshold,
// fly off past it. Buttons run the same animations. A pass is a
// Later (the card parks in the deck's pile, see DECKS below) and
// the primary action calls the exact handler the list view's
// button called.
// Drags capture only when they start on the card itself, so page
// scroll and the bottom nav are untouched.
const stackState = {};
function stackKeyOf(el) { return el.closest("[data-stack]").getAttribute("data-stack"); }
function stackAdvance(key, dir) {
  const s = stackState[key];
  if (!s) return;
  s.idx += 1;
  s.passed += dir === "pass" ? 1 : 0;
  const wrap = document.querySelector(`[data-stack="${key}"]`);
  if (wrap) renderStack(wrap);
}
function renderStack(wrap) {
  const key = wrap.getAttribute("data-stack");
  const s = stackState[key];
  if (!s) return;
  const total = s.items.length;
  const pos = document.querySelector(`[data-stackpos="${key}"]`);
  if (s.idx >= total) {
    if (s.onRoundEnd && s.onRoundEnd(wrap)) return;
    wrap.innerHTML = s.endHtml(s.passed, total);
    if (pos) pos.textContent = total ? `${total} of ${total}` : "";
    return;
  }
  if (pos) pos.textContent = `${s.idx + 1} of ${total}`;
  const behind = s.idx + 1 < total ? `<div class="stk-behind" aria-hidden="true">${s.cardHtml(s.items[s.idx + 1], s.idx + 1)}</div>` : "";
  wrap.innerHTML = behind + `<div class="stk-card">${s.round === 2 ? `<span class="stk-secondlook">Second look</span>` : ""}${s.cardHtml(s.items[s.idx], s.idx)}</div>`
    + `<div class="stk-actions"><button type="button" class="stk-pass" aria-label="Later: park this card" onclick="stackButton('${key}','pass')">Later</button><button type="button" class="stk-go" onclick="stackButton('${key}','go')">${esc(s.goLabelFor ? s.goLabelFor(s.items[s.idx]) : s.goLabel)}</button></div>`;
  const card = wrap.querySelector(".stk-card");
  if (card) attachStackDrag(wrap, card);
}
function stackButton(key, dir) {
  const wrap = document.querySelector(`[data-stack="${key}"]`);
  const s = stackState[key];
  if (!wrap || !s) return false;
  const card = wrap.querySelector(".stk-card");
  const item = s.items[s.idx];
  const finish = () => {
    if (dir === "go") s.onGo(item);
    else { s.onPass(item); stackAdvance(key, "pass"); }
  };
  if (card && !stackReducedMotion()) {
    card.style.transition = "transform .28s ease, opacity .28s ease";
    card.style.transform = `translateX(${dir === "go" ? 130 : -130}%) rotate(${dir === "go" ? 7 : -7}deg)`;
    card.style.opacity = "0";
    setTimeout(finish, 240);
  } else finish();
  return false;
}
function stackReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
}
function attachStackDrag(wrap, card) {
  let sx = 0, dx = 0, dragging = false, pid = null;
  // The card photo is the natural grab spot, and a native HTML image
  // drag cancels the pointer stream a few px in — which used to land
  // in the tap band and open the profile mid-drag. Native drags are
  // not stack drags: suppress them inside the card.
  card.addEventListener("dragstart", (e) => { e.preventDefault(); });
  card.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a, input, details, summary, form")) return;
    sx = e.clientX; dx = 0; dragging = true; pid = e.pointerId;
    try { card.setPointerCapture(pid); } catch (err) { /* capture is an enhancement */ }
    card.style.transition = "none";
  });
  card.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pid) return;
    dx = e.clientX - sx;
    card.style.transform = `translateX(${dx}px) rotate(${Math.max(-8, Math.min(8, dx / 16))}deg)`;
  });
  const end = (e, cancelled) => {
    if (!dragging || (e && e.pointerId !== pid)) return;
    dragging = false;
    const key = stackKeyOf(card);
    const s = stackState[key];
    if (!s) return;
    if (cancelled) {
      // A cancelled gesture (scroll takeover, native-drag abort) is
      // never a tap and never a swipe: just settle the card back.
      card.style.transition = "transform .25s ease";
      card.style.transform = "";
      dx = 0;
      return;
    }
    if (Math.abs(dx) > 90 && !stackReducedMotion()) {
      const dir = dx > 0 ? "go" : "pass";
      const item = s.items[s.idx];
      card.style.transition = "transform .25s ease, opacity .25s ease";
      card.style.transform = `translateX(${dir === "go" ? 130 : -130}%) rotate(${dir === "go" ? 7 : -7}deg)`;
      card.style.opacity = "0";
      setTimeout(() => { if (dir === "go") s.onGo(item); else { s.onPass(item); stackAdvance(key, "pass"); } }, 220);
    } else if (Math.abs(dx) <= 8) {
      card.style.transition = "transform .2s ease";
      card.style.transform = "";
      setTimeout(() => { if (s.onTap) s.onTap(s.items[s.idx]); }, 30);
    } else {
      card.style.transition = "transform .25s ease";
      card.style.transform = "";
    }
    dx = 0;
  };
  card.addEventListener("pointerup", (e) => end(e, false));
  card.addEventListener("pointercancel", (e) => end(e, true));
}
// Local audience % estimator help (audit F1 mitigation, 2026-10-22):
// the one canonical helper text under every local % field (full
// signup + profile edit). The gate itself is unchanged: a
// self-reported local % stays required for completion until
// Instagram verification exists. This teaches where the number
// comes from and licenses a rough estimate.
const LOCAL_PCT_HELP = "Instagram: Insights → Audience → top cities. Add the share in your market's cities. A rough number is fine — it's labeled Self-reported everywhere.";

// Picker disclosure (audit F3 mitigation, 2026-10-22): visit proof
// is an Instagram post link for now, and that rule is unchanged.
// When the picked primary platform is not Instagram, this one
// small-print line says so at the picker, instead of the creator
// finding out at their first visit with the clock running.
const PROOF_DISCLOSURE = "Heads up: visit proof is an Instagram post link for now, so SIGNL visits get posted on Instagram.";
function syncProofDisclosure(selectId, noteId) {
  const sel = document.getElementById(selectId);
  const note = document.getElementById(noteId);
  if (!note) return;
  note.style.display = sel && sel.value !== "instagram" ? "" : "none";
}
function syncPPlatform() { syncProofDisclosure("p-platform", "p-proof-note"); }

// The handle link for a creator payload: the primary profile URL
// when the server computed one, the Instagram URL for legacy
// payloads. Returns "" when neither exists.
function primaryUrlOf(p) {
  if (!p) return "";
  return p.primaryProfileUrl || p.instagramUrl || "";
}
// The cc-handle line: for an Instagram-primary creator the markup
// is byte-identical to what it has always been; any other primary
// platform links its own URL and names itself beside the handle.
function ccHandleHtml(p) {
  const url = primaryUrlOf(p);
  const plat = (p && p.primaryPlatform) || "instagram";
  const label = plat !== "instagram" ? ` <span class="small muted">on ${esc(primaryLabelClient(plat))}</span>` : "";
  return `<div class="cc-handle">@<a href="${esc(url)}" target="_blank" rel="noopener">${esc((p && p.handle) || "")}</a>${label}</div>`;
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
    summary: "Every SIGNL comped visit includes: 1 post or reel + 1 story that shares the post, within 48 hours of the visit, honest and disclosed, live at least 30 days, with tracked delivery proof. 48 hours is the standard creators are held to; a post inside one week still counts, as a late delivery. Paid bookings carry the deliverables set in the booking's own terms. Content rights follow the visit, never the plan: on a comp visit the business may share the post natively only, with the creator tagged; no downloads, no reposting the file, no ad use. On a paid visit the business may also repost the post and run it as an ad for 90 days from the post date, under the one standard license every paid booking includes. A comped post can be licensed the same way, for 90 days, at the creator's listed licensing fee and only with their approval. The creator always owns their content, and nobody can edit it.",
  };
}

// V3 (copy cut, 2026-10-25): the Standard Visit as tight labeled
// rows on a mint field region; the full canonical summary lives
// behind ONE tap. The rows carry the substance (post, rights,
// ownership) in fragments, the way Slotted cards carry data.
function standardVisitRowsHtml() {
  return `<div class="deal-rows">
    <div class="drow"><span class="dk">Post</span><span class="dv">1 post/reel + 1 story &middot; within 48h &middot; live 30 days</span></div>
    <div class="drow"><span class="dk">Comp rights</span><span class="dv">Native share only, creator tagged</span></div>
    <div class="drow"><span class="dk">Paid adds</span><span class="dv">Repost + ad use for 90 days</span></div>
    <div class="drow"><span class="dk">Ownership</span><span class="dv">Creators own their content. Nobody edits it.</span></div>
  </div>`;
}

function visitIncludesHtml(summary) {
  const text = summary || standardVisit().summary;
  return `<div class="visit-mint"><h4>Every comped visit includes</h4>${standardVisitRowsHtml()}
    <details class="deal-details"><summary>The Standard Visit, in full</summary><div class="dd-body"><p class="small">${esc(text)}</p></div></details>
  </div>`;
}

// V3: an offer's terms as compressed labeled rows (visible before
// any accept tap) + the full plain-words version behind one tap.
// Rights and deadlines stay visible in compressed form; nothing
// about the deal is deleted, it is demoted, never dropped.
function dealRowsHtml(o) {
  // V4 color-block split: the deal itself (You get / Included /
  // Experience) renders on the pale mint tint field; the terms
  // (Post / Rights) render as their own hairline-boxed block.
  // Same rows, same words — only the grouping changed.
  const main = [];
  const terms = [];
  if (o.kind === "paid") {
    const net = o.paidMath && o.paidMath.creatorNet !== undefined && o.paidMath.creatorNet !== null && o.paidMath.creatorNet !== "" ? `$${fmtMoney(o.paidMath.creatorNet)} (97%)` : "97%";
    main.push(["You get paid", `$${fmtPrice(o.cashRate)} &middot; you keep ${net}`]);
  } else {
    main.push(["You get", `${esc(o.whatComped)} &middot; $${fmtMoney(o.dollarCap)} cap &middot; ${Number(o.covers) === 2 ? "covers 2" : "covers you"}`]);
  }
  if (o.includes) main.push(["Included", esc(o.includes)]);
  if (o.experience) main.push(["Experience", esc(o.experience)]);
  terms.push(["Post", o.kind === "paid" ? "Per booking terms &middot; 48h &middot; live 30 days" : "1 post/reel + 1 story &middot; 48h &middot; honest, disclosed &middot; live 30 days"]);
  terms.push(["Rights", o.kind === "paid" ? "Share + repost + ads for 90 days &middot; no edits" : "Native share only &middot; no edits, downloads or ads"]);
  const render = (rows) => rows.map(([k, v]) => `<div class="drow"><span class="dk">${k}</span><span class="dv">${v}</span></div>`).join("");
  return `<div class="deal-rows deal-main">${render(main)}</div><div class="deal-rows deal-terms">${render(terms)}</div>`;
}

function dealPlainWordsHtml(o) {
  const rights = o.visitRights || rightsForVisit(o.kind);
  return `<details class="deal-details"><summary>The deal, in plain words</summary><div class="dd-body">
    <div class="showcase-block">
      ${o.kind === "paid"
        ? `<p class="small"><strong>You get paid:</strong> $${fmtPrice(o.cashRate)} for this paid booking, on the deliverables set in its terms. You keep $${o.paidMath ? fmtMoney(o.paidMath.creatorNet) : ""} (97% of the rate); SIGNL holds the payment and releases it when your post is live.</p>`
        : `<p class="small"><strong>You get:</strong> ${esc(o.whatComped)} (comp cap $${fmtMoney(o.dollarCap)}) &middot; ${coversLine(o)}</p>`}
      ${o.kind === "paid" && o.paidBrief ? `<p class="small"><strong>Key points from the business:</strong> ${esc(o.paidBrief)}</p>` : ""}
      ${o.includes ? `<p class="small"><strong>Included:</strong> ${esc(o.includes)}</p>` : ""}
      ${o.experience ? `<p class="small"><strong>The experience:</strong> ${esc(o.experience)}</p>` : ""}
      ${o.kind === "paid" ? `<p class="small"><strong>You post:</strong> the deliverables set in this booking's terms, posted within 48 hours of your visit, honest and disclosed. The post stays live at least 30 days. You check off by pasting the post link in My Visits.</p>` : `<p class="small"><strong>You post:</strong> 1 post or reel + 1 story that shares the post, within 48 hours of your visit, honest, with the comp disclosed. The post stays live at least 30 days. You check off by pasting the post link in My Visits.</p>`}
      <p class="small muted">Up to a week at the outside. 48 hours is the standard and earns the Momentum.</p>
      <p class="small"><strong>They can:</strong> ${rights.can.map(esc).join("; ")}</p>
      <p class="small"><strong>They can't:</strong> ${rights.cannot.map(esc).join("; ")}</p>
    </div>
  </div></details>`;
}

// Refinement bundle (2026-10-20): the creator free line, word for
// word, everywhere creators meet SIGNL. It never sits next to
// paid-lane fee math. The Visit Guarantee line is the business
// twin: one sentence on the Plan tab and in the composer.
const CREATOR_FREE_LINE = "SIGNL is free for creators. Always. Businesses pay the platform. You never pay to join, to list, or to get booked.";
const VISIT_GUARANTEE_LINE = "Visit Guarantee: if a booked creator does not show up or does not post, that visit does not count against your monthly visits. It is replaced.";
const PAID_BRIEF_GUIDANCE = "Key points only: what to feature, names, dates. Creators post honestly in their own words. No scripts, no required praise, no post pre-approval.";

// How many people a comp covers, in checklist words. Records from
// before the covers field read as 1 ("Comp covers you").
function coversLine(record) {
  return record && Number(record.covers) === 2 ? "Comp covers 2 people" : "Comp covers you";
}

// Content rights by visit type, mirroring the server's
// visitRightsForVisit (rights model adopted 2026-10-21: rights
// follow the visit, never the plan). The creator's offer checklist
// prefers the server-attached rights on the offer itself; this is
// the fallback and the composer's rights line.
function rightsForVisit(kind) {
  if (kind === "paid") {
    return {
      can: ["Share your post natively, with you tagged", "Repost it on their own feed", "Run it as an ad for 90 days from the post date (never longer)"],
      cannot: ["Edit your post", "Use it in ads after the 90-day window"],
    };
  }
  return {
    can: ["Share your post natively, with you tagged"],
    cannot: ["Edit it", "Download it or post it as their own content", "Run it as an ad"],
  };
}

// Compliance standing banner for creators (paused / banned).
function standingBannerHtml(u) {
  const st = u && u.standing;
  if (!st || !st.state || st.state === "good") return "";
  if (st.state === "paused") {
    if (st.source === "strikes") {
      return `<div class="notice"><strong>Your account is paused for review.</strong> Three booked visit windows expired unused. The SIGNL team reviews every pause by hand, and reinstated accounts restart one strike short of the limit. Questions: hello@joinsignl.com</div>`;
    }
    return `<div class="notice"><strong>Your account is paused.</strong> A post from a comped visit is past due. Paste the post link under My Visits and your account unpauses automatically. Until then, businesses see you greyed out and cannot send you new offers.</div>`;
  }
  if (st.state === "banned") {
    return `<div class="error-box"><strong>Your account is closed to offers.</strong> ${esc(st.reason || "A comped visit was redeemed and no post was delivered.")}<br>Questions: hello@joinsignl.com</div>`;
  }
  return "";
}

// The creator's own strike count, in plain language, shown
// whenever it is above zero (refinement bundle, 2026-10-20).
function strikeStatusHtml(u) {
  const n = u && Number(u.noShowStrikes) > 0 ? Math.floor(Number(u.noShowStrikes)) : 0;
  if (!n) return "";
  return `<p class="small"><strong>Visit strikes: ${n}.</strong> Letting a booked visit window expire unused counts as a strike, and strikes can pause your account for review.</p>`;
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Short card date ("Oct 27"): cards show dates, detail screens
// keep full timestamps (UX redesign section 6).
function fmtDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function hoursLeft(deadline) {
  if (!deadline) return null;
  const ms = Date.parse(deadline) - Date.now();
  return ms / 3600000;
}

// Business access state (server-enforced): an approved business
// stays on the founding list until an admin activates it by hand.
// Anything other than accessState "active" is founding.
function businessAccessState(u) {
  return u && u.role === "business" && u.business && u.business.accessState === "active" ? "active" : "founding";
}

function isFoundingBusiness(u) {
  return !!u && u.role === "business" && businessAccessState(u) !== "active";
}

function renderNav() {
  if (state.view === "staff") {
    // Staff mode has no navigation of its own: the register screen
    // does one job. The bar carries the brand and the way out.
    topnav.innerHTML = state.staff
      ? `<span class="muted small">${esc(state.staff.businessName)} &middot; Staff mode</span>
         <button class="linklike" onclick="staffExit()">End staff session</button>`
      : `<span class="muted small">Staff redemption</span>
         <a href="#" onclick="return go('home')">Back to SIGNL home</a>`;
    renderBottomNav();
    return;
  }
  if (!state.user) {
    topnav.innerHTML = `
      <a href="#" onclick="return go('signin')">Sign in</a>
      <a class="nav-cta" href="#" onclick="return go('join-creator')">Join as a Founding Creator</a>
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
    heart: `<path d="M12 20.5C7 16.5 3.5 13.2 3.5 9.3A4.6 4.6 0 0 1 8.1 4.7c1.6 0 3 .8 3.9 2 .9-1.2 2.3-2 3.9-2a4.6 4.6 0 0 1 4.6 4.6c0 3.9-3.5 7.2-8.5 11.2z"/>`,
    stats: `<path d="M3.5 20.5h17"/><path d="M6.5 20.5v-7M12 20.5V4.5M17.5 20.5v-10"/>`,
    users: `<circle cx="9" cy="8.2" r="3.4"/><path d="M3.2 20c.7-3.1 2.9-4.7 5.8-4.7s5.1 1.6 5.8 4.7"/><path d="M16.2 5.4a3.4 3.4 0 0 1 0 5.9"/><path d="M18 15.6c1.6.6 2.6 2 3 4.4"/>`,
    image: `<rect x="3.5" y="5" width="17" height="14.5" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="m5 19 5.2-5.2 3 3L17 13l3 3.4"/>`,
    chat: `<path d="M20.5 12a8 8 0 0 1-8 8c-1.4 0-2.7-.3-3.9-.9L3.5 20.5l1.4-4.9A8 8 0 1 1 20.5 12Z"/>`,
    wallet: `<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><path d="M16.5 15.2h.9"/>`,
    inbox: `<path d="M3.8 13.4 5.9 5h12.2l2.1 8.4V18a1.8 1.8 0 0 1-1.8 1.8H5.6A1.8 1.8 0 0 1 3.8 18Z"/><path d="M3.8 13.4h5.4l1.3 2.3h3l1.3-2.3h5.4"/>`,
    shield: `<path d="M12 3.5 5 6v5.4c0 4.5 3 7.6 7 9.1 4-1.5 7-4.6 7-9.1V6Z"/><path d="m9 11.6 2.2 2.2 4-4.2"/>`,
    search: `<circle cx="11" cy="11" r="6.5"/><path d="m20.5 20.5-4.6-4.6"/>`,
    check: `<path d="m4.5 12.5 5 5 10-11"/>`,
    // Overhaul V3 icon set (spec §3): single-weight line glyphs
    // drawn for SIGNL. None of these reuse the V2/Grin glyphs
    // (pulse wave, inbox tray, chart arrow, two people,
    // storefront, chain link, handshake, bare chat bubble, photo
    // frame, gift box, black agent face).
    deck: `<rect x="3" y="7.5" width="11.5" height="13" rx="2.5"/><rect x="9.5" y="3.5" width="11.5" height="13" rx="2.5"/><path d="M17.6 6.4l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="currentColor" stroke="none"/>`,
    notice: `<rect x="5" y="5" width="14" height="15.5" rx="2"/><circle cx="12" cy="5" r="1.7"/><path d="M8.6 11h6.8M8.6 14.8h4.6"/>`,
    calendar: `<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.8h17M8 3v3.6M16 3v3.6"/><path d="m9 15.4 2.1 2.1 3.9-4.3"/>`,
    banknote: `<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.9"/><path d="M5.8 9.3h.8M17.4 14.7h.8"/>`,
    bubble: `<path d="M4 5.8A2.8 2.8 0 0 1 6.8 3h10.4A2.8 2.8 0 0 1 20 5.8v7.4a2.8 2.8 0 0 1-2.8 2.8h-4.4L8.4 20.2v-4.2H6.8A2.8 2.8 0 0 1 4 13.2z"/><path d="M7.8 8h8.4M7.8 11.4h5"/>`,
    list3: `<circle cx="4.2" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.2" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.2" cy="18" r="1.3" fill="currentColor" stroke="none"/><path d="M9 6h11.5M9 12h11.5M9 18h11.5"/>`,
    bars: `<rect x="4.6" y="13.5" width="3.6" height="7"/><rect x="10.2" y="4.5" width="3.6" height="16"/><rect x="15.8" y="9.5" width="3.6" height="11"/>`,
    play: `<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M10.4 9.1v5.8l5-2.9z" fill="currentColor" stroke="none"/>`,
    receipt: `<path d="M6 3h12v17.2l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z"/><path d="M9.2 7.6h5.6M9.2 11h5.6M9.2 14.4h3.4"/>`,
    person: `<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="9.9" r="2.9"/><path d="M6.9 17.1c1.2-2.3 3-3.3 5.1-3.3s3.9 1 5.1 3.3"/>`,
    keypad: `<circle cx="6.5" cy="6.5" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="6.5" r="1.35" fill="currentColor" stroke="none"/><circle cx="17.5" cy="6.5" r="1.35" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="17.5" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="6.5" cy="17.5" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="17.5" r="1.35" fill="currentColor" stroke="none"/><circle cx="17.5" cy="17.5" r="1.35" fill="currentColor" stroke="none"/>`,
    bolt: `<path d="M13 2.8 4.9 13.4h5.5l-1 7.8 8.4-11.3h-5.6z"/>`,
    sliders: `<path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/><circle cx="9" cy="6.5" r="2.1" fill="#fff"/><circle cx="15.5" cy="12" r="2.1" fill="#fff"/><circle cx="7.5" cy="17.5" r="2.1" fill="#fff"/>`,
    help: `<circle cx="12" cy="12" r="8.6"/><path d="M9.7 9.3A2.5 2.5 0 1 1 12 11.8v1.2"/><path d="M12 16.9h.01"/>`,
    star: `<path d="m12 3.2 2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 9.6l6-.9z"/>`,
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}

// App-style bottom navigation (Jeff, 2026-10-18; unified in the
// UX redesign, 2026-10-24): ONE nav system per role at every width.
// Signed-in views render the bar at all widths (centered, max
// width on desktop); signed-out views keep the mobile-only bar.
// Tab badges ride the counts GET /notifications returns.
function renderBottomNav() {
  // Overhaul V3 (2026-10-27): five labeled destinations in a
  // bottom tab bar on phones; the same five as a labeled left
  // rail on desktop, with the More rows expanded inline under a
  // hairline; a slim top bar (identity, Messages, help) rides
  // every app screen. The admin console keeps the V2 icon rail.
  // This entry point keeps its name because nav renders, badge
  // refreshes and sign-in/out all call it.
  const u = state.user;
  const tabbar = document.getElementById("tabbar");
  const top2 = document.getElementById("topbar2");
  const rail = document.getElementById("rail");
  const toprow = document.getElementById("toprow");
  document.body.classList.remove("bn-on", "has-bn");
  if (u && u.role === "admin" && !state.preview) {
    if (tabbar) tabbar.innerHTML = "";
    if (top2) top2.innerHTML = "";
    document.body.classList.remove("v3-on", "v3-slim");
    renderRail();
    return;
  }
  if (rail) rail.innerHTML = "";
  if (toprow) toprow.innerHTML = "";
  document.body.classList.remove("rail-on");
  const inApp = !!u && state.view !== "staff" && (u.role === "business" || u.role === "creator");
  if (!inApp) {
    if (tabbar) tabbar.innerHTML = "";
    if (top2) top2.innerHTML = "";
    document.body.classList.remove("v3-on", "v3-slim");
    return;
  }
  const full = u.status === "approved" && (u.role === "creator" || businessAccessState(u) === "active");
  document.body.classList.toggle("v3-on", full);
  document.body.classList.toggle("v3-slim", !full);
  renderTopBar2(full);
  if (tabbar) tabbar.innerHTML = full ? tabBarHtml() : "";
}

// V3 destinations (spec §2): exactly five per role, icon plus an
// always-visible text label, never renamed between widths. The
// internal tab names stay the V2 ones; only the labels changed.
const MORE_TABS = ["More", "Analytics", "Content", "Plan", "Profile", "Messages", "Settings", "Help", "Momentum", "Status", "Numbers"];
function tabItemsFor() {
  const u = state.user;
  if (!u) return [];
  const t = state.tab;
  const b = state.badges || {};
  const wc = state.waitCounts || {};
  if (u.role === "business") {
    return [
      { icon: "home", label: "Home", tab: "Home", on: t === "Home" || !t },
      { icon: "deck", label: "Find creators", tab: "Discover", on: t === "Discover" || t === "Favorites" },
      { icon: "notice", label: "Offers", tab: "My Offers", on: t === "My Offers" || t === "Requests", badge: wc.bizApps != null ? wc.bizApps : (b.offers || 0) },
      { icon: "calendar", label: "Visits", tab: "Visits & Posts", on: t === "Visits & Posts" || t === "Counter", badge: wc.bizVisits != null ? wc.bizVisits : (b.visits || 0) },
      { icon: "list3", label: "More", tab: "More", on: MORE_TABS.includes(t) },
    ];
  }
  if (u.role === "creator") {
    const live = !!(u.founding && u.founding.marketLive);
    if (!live) {
      return [
        { icon: "home", label: "Home", tab: "Dashboard", on: t === "Dashboard" || !t },
        { icon: "list3", label: "More", tab: "More", on: ["More", "Profile", "Status", "Settings", "Help", "Momentum", "Numbers", "Messages"].includes(t) },
      ];
    }
    return [
      { icon: "home", label: "Home", tab: "Dashboard", on: t === "Dashboard" || !t },
      { icon: "deck", label: "Offers", tab: "Offers", on: t === "Offers", badge: wc.crInvites != null ? wc.crInvites : (b.offers || 0) },
      { icon: "calendar", label: "Visits", tab: "My Visits", on: t === "My Visits", badge: wc.crVisits != null ? wc.crVisits : (b.visits || 0) },
      { icon: "banknote", label: "Earnings", tab: "Earnings", on: t === "Earnings", badge: wc.crLicense || 0 },
      { icon: "list3", label: "More", tab: "More", on: MORE_TABS.includes(t) },
    ];
  }
  return [];
}

// The More rows (spec §5.7 / §6.6): the things you check, not
// the things you work. Rendered as the More screen on phones
// and expanded inline in the desktop rail.
function moreRowsFor() {
  const u = state.user;
  if (!u) return [];
  const b = state.badges || {};
  if (u.role === "business") {
    return [
      { icon: "bars", label: "Results", sub: "What your campaigns did.", tab: "Analytics" },
      { icon: "play", label: "Posts & licenses", sub: "Every post about you, and the ones you can reuse.", tab: "Content" },
      { icon: "receipt", label: "Plan & billing", sub: "Your plan, your visits, your billing.", tab: "Plan" },
      { icon: "person", label: "Your business page", sub: "How creators see your business.", tab: "Profile" },
      { icon: "bubble", label: "Messages", sub: "Talk to a creator about a visit or an offer.", tab: "Messages", badge: b.messages || 0 },
      { icon: "sliders", label: "Settings", sub: "Account, staff PIN, notifications.", tab: "Settings" },
      { icon: "help", label: "Help", sub: "How SIGNL works, in plain words.", tab: "Help" },
    ];
  }
  if (u.role === "creator") {
    const rows = [
      { icon: "person", label: "My profile", sub: "What businesses see, your rate, your links.", tab: "Profile" },
      { icon: "bars", label: "Your numbers", sub: "What your posts and visits did.", tab: "Numbers" },
      { icon: "bolt", label: "Momentum", sub: "Your points, your tier, what earns more.", tab: "Momentum" },
      { icon: "bubble", label: "Messages", sub: "Talk to a business about a visit or an offer.", tab: "Messages", badge: b.messages || 0 },
      { icon: "sliders", label: "Settings", sub: "Account and notifications.", tab: "Settings" },
      { icon: "help", label: "Help", sub: "How SIGNL works, in plain words.", tab: "Help" },
    ];
    return rows;
  }
  return [];
}

function tabBarHtml() {
  const items = tabItemsFor();
  if (!items.length) return "";
  const btns = items.map((it) => `
    <button type="button" class="tab-item ${it.on ? "on" : ""}" onclick="return go('dashboard','${it.tab}')" aria-label="${esc(it.label)}">
      <span class="tab-ic">${bnIcon(it.icon)}${it.badge ? `<span class="tab-badge">${it.badge > 99 ? "99+" : it.badge}</span>` : ""}</span>
      <span class="tab-label">${esc(it.label)}</span>
    </button>`).join("");
  const more = moreRowsFor().map((r) => `
    <button type="button" class="tab-more-row ${state.tab === r.tab ? "on" : ""}" onclick="return go('dashboard','${r.tab}')">
      <span class="tab-ic">${bnIcon(r.icon)}</span><span class="tab-label">${esc(r.label)}</span>${r.badge ? `<span class="tab-badge inline">${r.badge > 99 ? "99+" : r.badge}</span>` : ""}
    </button>`).join("");
  return `<div class="tab-main">${btns}</div>${more ? `<div class="tab-more"><div class="tab-more-sep"></div>${more}</div>` : ""}`;
}

// The slim V3 top bar: avatar chip + account name on the left;
// Messages (unread badge) and help on the right, on every app
// screen for both roles (spec §2.1).
function renderTopBar2(full) {
  const el = document.getElementById("topbar2");
  if (!el) return;
  const u = state.user;
  const name = u.role === "business" && u.business ? u.business.businessName : u.name;
  const photo = u.role === "creator" && u.creator ? u.creator.photoUrl : null;
  const initial = String(name || "?").trim().charAt(0).toUpperCase() || "S";
  const b = state.badges || {};
  const live = u.role === "business" ? businessAccessState(u) === "active" : !!(u.founding && u.founding.marketLive);
  el.innerHTML = `<div class="tb2-in">
    <button type="button" class="tb2-id" onclick="return go('dashboard','Profile')">
      ${photo ? `<img class="tb2-ava" src="${esc(photo)}" alt="">` : `<span class="tb2-ava txt">${esc(initial)}</span>`}
      <span class="tb2-name">${esc(name || "")}</span>
    </button>
    <span class="tb2-actions">
      ${full && (live || u.role === "creator") ? `<button type="button" class="tb2-btn" onclick="return go('dashboard','Messages')" aria-label="Messages">${bnIcon("bubble")}${b.messages ? `<span class="tab-badge">${b.messages > 99 ? "99+" : b.messages}</span>` : ""}</button>` : ""}
      ${full ? `<button type="button" class="tb2-btn" onclick="return go('dashboard','Help')" aria-label="Help">${bnIcon("help")}</button>` : `<a class="tb2-btn" href="mailto:hello@joinsignl.com" aria-label="Help">${bnIcon("help")}</a>`}
    </span>
  </div>`;
}
async function refreshBadges() {
  if (!state.user) { state.badges = null; return; }
  try {
    const data = await api("GET", "/notifications");
    state.badges = data.badges || null;
    renderBottomNav();
  } catch (e) { /* badges are an enhancement, never a blocker */ }
}

// The business More sheet: the sections that do not fit the bar,
// each row a full-width tap target, Messages carrying its badge.

function openMoreSheet() {
  closeMoreSheet();
  const b = state.badges || {};
  const row = (label, tab, badge) => `
    <button class="sheet-row" onclick="closeMoreSheet(); return go('dashboard','${tab}')"><span>${label}</span>${badge ? `<span class="bn-badge static">${badge > 99 ? "99+" : badge}</span>` : ""}</button>`;
  const el = document.createElement("div");
  el.id = "more-sheet";
  el.className = "sheet-overlay";
  el.innerHTML = `
  <div class="sheet" role="dialog" aria-label="More">
    <div class="flex-between"><strong>More</strong><button class="linklike" onclick="closeMoreSheet()">Close</button></div>
    ${row("Favorites", "Favorites", 0)}
    ${row("Visits &amp; Posts", "Visits & Posts", 0)}
    ${row("Plan", "Plan", 0)}
    ${row("Messages", "Messages", b.messages || 0)}
    <button class="sheet-row" onclick="closeMoreSheet(); signOut()"><span>Sign out</span></button>
  </div>`;
  el.addEventListener("click", (e) => { if (e.target === el) closeMoreSheet(); });
  document.body.appendChild(el);
  return false;
}

function closeMoreSheet() {
  const el = document.getElementById("more-sheet");
  if (el) el.remove();
  return false;
}

// ---------- Overhaul Stage 1 shell (Jeff, 2026-10-27) ----------
// A persistent left rail at desktop widths carries the same
// destinations as the phone's bottom bar (same labels, same
// badges, same go() targets); below 1100px the rail hides and
// the bottom bar carries the app exactly as before. The floating
// spark button + Ready-for-you card are agent-ready STRUCTURE:
// each home computes its real waiting queue (applications,
// deadlines, licenses) and hands it over; there is no agent
// logic behind the button in this stage.
const SPARK_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.1 6.9L21 11l-6.9 2.1L12 20l-2.1-6.9L3 11l6.9-2.1z"/></svg>`;

// Sig's face lives in exactly ONE place (V3 spec §4): the
// axolotl (Jeff's pick, 2026-10-27) — a gradient blue-to-green
// axolotl whose gills fan like signal bursts, cropped from the
// character artwork into public/assets/sig-axolotl.png. Swap
// this constant and every Sig surface updates at once.
const SIG_AVATAR_HTML = `<span class="sig-ava sig-ava-img"><img src="/assets/sig-axolotl.png" alt="Sig"></span>`;

// Overhaul V2 rail item sets (2026-10-27): the slim icon rail is
// the navigation at EVERY width, mirroring the Grin template —
// grouped icons, hairline separators between groups, the active
// icon in a soft tile with the accent glyph, a count bubble, and
// the account avatar chip pinned at the bottom. Groups are marked
// by sec changes ("a", "b", "c"); the renderer draws a hairline
// when the group changes.
function railItems() {
  if (!state.user || state.view === "staff" || state.preview) return null;
  const u = state.user;
  const t = state.tab;
  const b = state.badges || {};
  const items = [];
  const add = (sec, icon, label, onclick, active, badge) => items.push({ sec, icon, label, onclick, active: !!active, badge: badge || 0 });
  if (u.role === "admin") {
    add("a", "requests", "Requests", "return go('dashboard','Applications')", t === "Applications" || !t);
    add("a", "pin", "Markets", "return go('dashboard','Markets')", t === "Markets");
    add("a", "list", "Event Log", "return go('dashboard','Event Log')", t === "Event Log");
    add("a", "stats", "Stats", "return go('dashboard','Stats')", t === "Stats");
    add("b", "heart", "Recruiters", "return go('dashboard','Recruiters')", t === "Recruiters");
    add("b", "shield", "Compliance", "return go('dashboard','Compliance')", t === "Compliance");
    add("b", "users", "Campaign", "return go('dashboard','Campaign')", t === "Campaign");
    return items;
  }
  if (u.status !== "approved" || isFoundingBusiness(u)) {
    add("a", "status", "Status", "return go('dashboard')", true);
    return items;
  }
  if (u.role === "creator") {
    const live = !!(u.founding && u.founding.marketLive);
    add("a", "home", "Home", "return go('dashboard','Dashboard')", t === "Dashboard" || !t);
    if (!live) {
      add("a", "profile", "Profile", "return go('dashboard','Profile')", t === "Profile");
      add("a", "status", "Status", "return go('dashboard','Status')", t === "Status");
    } else {
      add("a", "offers", "Offers", "return go('dashboard','Offers')", t === "Offers", b.offers);
      add("a", "visits", "My Visits", "return go('dashboard','My Visits')", t === "My Visits", b.visits);
      add("b", "chat", "Messages", "return go('dashboard','Messages')", t === "Messages", b.messages);
      add("b", "profile", "Profile", "return go('dashboard','Profile')", t === "Profile");
    }
    return items;
  }
  if (u.role === "business") {
    add("a", "home", "Home", "return go('dashboard','Home')", t === "Home" || !t, b.visits);
    add("a", "inbox", "Requests", "return go('dashboard','Requests')", t === "Requests", b.offers);
    add("a", "stats", "Analytics", "return go('dashboard','Analytics')", t === "Analytics");
    add("b", "users", "Discover", "return go('dashboard','Discover')", t === "Discover" || t === "Favorites");
    add("b", "offers", "Offers", "return go('dashboard','My Offers')", t === "My Offers", b.offers);
    add("b", "building", "Profile", "return go('dashboard','Profile')", t === "Profile");
    add("c", "chat", "Messages", "return go('dashboard','Messages')", t === "Messages", b.messages);
    add("c", "image", "Content", "return go('dashboard','Content')", t === "Content");
    add("c", "list", "Visits & Posts", "return go('dashboard','Visits & Posts')", t === "Visits & Posts");
    add("c", "visits", "Counter", "return go('dashboard','Counter')", t === "Counter");
    add("c", "wallet", "Plan", "return go('dashboard','Plan')", t === "Plan");
    return items;
  }
  return null;
}

function renderRail() {
  const rail = document.getElementById("rail");
  if (!rail) return;
  // Overhaul V3: the icon rail is the admin console's chrome
  // only. Business and creator chrome is the tab bar + top bar
  // (renderBottomNav); a stray call from a screen loader must
  // never resurrect the V2 rail for them.
  if (!state.user || state.user.role !== "admin") { rail.innerHTML = ""; document.body.classList.remove("rail-on"); return; }
  const items = railItems();
  document.body.classList.toggle("rail-on", !!items);
  if (!items) { rail.innerHTML = ""; return; }
  const u = state.user;
  const name = u.role === "business" && u.business ? u.business.businessName : u.name;
  const initial = String(name || u.name || "?").trim().charAt(0).toUpperCase() || "S";
  const avatarGo = u.role === "business" ? "return go('profile')" : u.role === "creator" ? "return go('dashboard','Profile')" : "return go('dashboard')";
  let lastSec = "";
  const rows = items.map((it) => {
    const sec = lastSec && it.sec !== lastSec ? `<div class="rail-sep"></div>` : "";
    lastSec = it.sec;
    return `${sec}<button type="button" class="rail-item ${it.active ? "on" : ""}" title="${esc(it.label)}" aria-label="${esc(it.label)}" onclick="${it.onclick}"><span class="bn-icon">${bnIcon(it.icon)}</span>${it.badge ? `<span class="rail-badge">${it.badge > 99 ? "99+" : it.badge}</span>` : ""}</button>`;
  }).join("");
  rail.innerHTML = `
    <button type="button" class="rail-brand" title="SIGNL" aria-label="SIGNL home" onclick="return go('dashboard')"><img src="/assets/icon.png" alt="SIGNL"></button>
    ${rows}
    <div class="rail-foot">
      <button type="button" class="rail-item" title="Sign out" aria-label="Sign out" onclick="signOut()"><span class="bn-icon">${bnIcon("signout")}</span></button>
      <button type="button" class="rail-avatar" title="${esc(name || "Account")}" aria-label="Your account" onclick="${avatarGo}">${esc(initial)}</button>
    </div>`;
  renderTopRow();
}

// The quiet top row inside the content column (Grin pattern):
// account identity left, a numbers shortcut + "Need help?" right.
// Rendered by the rail pass so it appears and disappears with it.
function renderTopRow() {
  const el = document.getElementById("toprow");
  if (!el) return;
  const u = state.user;
  if (!u || state.preview || state.view === "staff" || !document.body.classList.contains("rail-on")) { el.innerHTML = ""; return; }
  const name = u.role === "business" && u.business ? u.business.businessName : u.name;
  const initial = String(name || u.name || "?").trim().charAt(0).toUpperCase() || "S";
  const statsGo = u.role === "business" ? "return go('dashboard','Analytics')" : "return go('dashboard')";
  el.innerHTML = `<div class="wrap tr-in"><span class="tr-ava">${esc(initial)}</span><span class="tr-name">${esc(name || "")}</span><span class="tr-right"><button type="button" onclick="${statsGo}" title="Your numbers" aria-label="Your numbers">${bnIcon("stats")}</button><a href="mailto:hello@joinsignl.com">Need help?</a></span></div>`;
}

// Ready-for-you queue: homes compute it from real records and
// register it here; the card renders inline on the home and the
// floating button opens the same queue as a sheet.
function setAgentFab(queue) {
  state.agentQueue = queue || null;
  renderAgentFab();
}
function renderAgentFab() {
  const fab = document.getElementById("agent-fab");
  if (!fab) return;
  const q = state.agentQueue;
  if (!q || !state.user || state.preview) { fab.classList.remove("show"); fab.innerHTML = ""; fab.onclick = null; return; }
  fab.classList.add("show");
  fab.innerHTML = `${SPARK_SVG}${q.count ? `<span class="fab-badge">${q.count}</span>` : ""}`;
  fab.onclick = openAgentSheet;
}
// Overhaul V2: the ready-for-you card is the Grin agent card —
// a soft accent-tint card, the agent's avatar, one bold line
// ("Sig has N things ready for you"), and white pill actions.
// In the sheet the same queue renders as full rows so long
// explanations keep their room.
function readyRowsHtml(q, opts) {
  if (!q.rows || !q.rows.length) return `<p class="sig-empty">${esc(q.empty || "All caught up. Nothing is waiting on you.")}</p>`;
  if (opts && opts.inSheet) {
    return q.rows.map((r, i) => `
    <div class="sig-srow"><div class="sig-stxt">${esc(r.text)}${r.sub ? `<div class="muted" style="font-size:.82rem">${esc(r.sub)}</div>` : ""}</div>${r.btn ? `<button type="button" class="btn small-btn" data-rq="${i}">${esc(r.btn)}</button>` : ""}</div>`).join("");
  }
  return `<div class="sig-pills">${q.rows.slice(0, 4).map((r, i) => `<button type="button" class="sig-pill" data-rq="${i}" title="${esc(r.text)}">${esc(r.pill || r.btn || r.text)}</button>`).join("")}${q.rows.length > 4 ? `<button type="button" class="sig-pill" onclick="openAgentSheet()">See all ${q.rows.length}</button>` : ""}</div>`;
}
function readyCardHtml(q) {
  if (!q) return "";
  const n = q.count || 0;
  const title = n ? `Sig has ${n} thing${n === 1 ? "" : "s"} ready for you` : esc(q.title || "Your queue is clear");
  const sub = n ? "One tap takes you straight to it." : esc(q.empty || "Sig is watching the queue. New items land here first.");
  return `<div class="sig-card"><div class="sig-top">${SIG_AVATAR_HTML}<div><div class="sig-title">${title}</div><div class="sig-sub">${sub}</div></div></div>${n ? readyRowsHtml(q) : ""}</div>`;
}
// The "Your goals" card (Grin pattern): a plain-language goal
// slot on the home. Structure only in V2 — Sig does not act on
// goals yet, and the card says so instead of implying it does.
function goalsCardHtml() {
  return `<div class="goals-card"><h3>Your goals</h3><p>No goals yet. Soon you will be able to tell Sig what you want, in plain words, and watch progress here. Sig does not act on goals yet.</p></div>`;
}

// ---------- Overhaul V3 components (spec §4–§6) ----------
// Sig's queue card: a mint field, Sig's face at the head, at
// most 3 items visible, each one plain sentence with a real
// count and ONE action button of at most 3 words; "See all N"
// expands in place. Parity rule (§4.7): every item also lives
// at a manual address; the button navigates or pre-fills and
// the user taps the final action there. The one exception is
// the standard nudge, where this button IS the user's tap.
function sigQueueHtml(items, opts) {
  const o = opts || {};
  const n = items.length;
  if (!n) {
    return `<div class="sig-card"><div class="sig-top">${SIG_AVATAR_HTML}<div><div class="sig-title">You're all caught up.</div><div class="sig-sub">When a creator applies, a visit needs you, or a post lands, it shows up here.</div></div></div>${(o.links || []).length ? `<div class="sig-links">${o.links.map((l, i) => `<button type="button" class="sig-link" data-sq="L${i}">${esc(l.label)}</button>`).join("")}</div>` : ""}</div>`;
  }
  const row = (r, i) => `<div class="sig-item"><div class="sig-stxt">${esc(r.text)}</div>${r.btn ? `<button type="button" class="btn small-btn" data-sq="${i}">${esc(r.btn)}</button>` : ""}</div>`;
  return `<div class="sig-card"><div class="sig-top">${SIG_AVATAR_HTML}<div><div class="sig-title">Sig has ${n} thing${n === 1 ? "" : "s"} for you</div><div class="sig-sub">In the order they need you.</div></div></div>
  ${items.slice(0, 3).map(row).join("")}
  ${n > 3 ? `<div class="sig-more" hidden>${items.slice(3).map((r, j) => row(r, j + 3)).join("")}</div><button type="button" class="sig-seeall" onclick="return sigSeeAll(this)">See all ${n}</button>` : ""}
  </div>`;
}
function sigSeeAll(btn) {
  const card = btn && btn.closest ? btn.closest(".sig-card") : null;
  const more = card && card.querySelector(".sig-more");
  if (more) { more.hidden = false; btn.remove(); }
  return false;
}
function wireSigQueue(root, items, links) {
  if (!root) return;
  root.querySelectorAll("[data-sq]").forEach((btn) => {
    btn.onclick = () => {
      const k = btn.getAttribute("data-sq");
      const r = k.charAt(0) === "L" ? (links || [])[Number(k.slice(1))] : items[Number(k)];
      if (r && r.act) r.act(btn);
    };
  });
}

// The launch checklist (spec §4.6): numbered steps, done steps
// collapsed with checks, the next undone step expanded with
// its action. Retires permanently once every non-optional
// step is done (the creator's paid-rate step is optional).
function checklistHtml(steps) {
  const gated = steps.filter((s) => !s.optional);
  if (gated.length && gated.every((s) => s.done)) return "";
  const done = steps.filter((s) => s.done).length;
  const nextIdx = steps.findIndex((s) => !s.done);
  return `<div class="check-card"><div class="check-head"><strong>Getting set up</strong><span class="muted small">${done} of ${steps.length} done</span></div>
  ${steps.map((s, i) => s.done
    ? `<div class="check-row done"><span class="check-ic">${bnIcon("check")}</span><span class="check-tx">${esc(s.label)}</span></div>`
    : i === nextIdx
      ? `<div class="check-row next"><span class="check-ic num">${i + 1}</span><div class="check-tx"><div>${esc(s.label)}${s.optional ? ` <span class="badge info">Optional</span>` : ""}</div>${s.sub ? `<div class="muted small">${esc(s.sub)}</div>` : ""}</div>${s.btn ? `<button type="button" class="btn small-btn" data-ck="${i}">${esc(s.btn)}</button>` : ""}</div>`
      : `<div class="check-row"><span class="check-ic num dim">${i + 1}</span><span class="check-tx muted">${esc(s.label)}</span></div>`).join("")}
  </div>`;
}
function wireChecklist(root, steps) {
  if (!root) return;
  root.querySelectorAll("[data-ck]").forEach((btn) => {
    btn.onclick = () => { const s = steps[Number(btn.getAttribute("data-ck"))]; if (s && s.act) s.act(); };
  });
}

// The Home snapshot strip (spec §4.1): 2–3 real numbers once
// they exist; before that, the slot carries the fills-in line,
// never a row of zeros.
function snapshotHtml(cells, fillLine, tab) {
  if (!cells || !cells.length) return `<button type="button" class="snap-strip fill" onclick="return go('dashboard','${tab}')"><span class="snap-fill">${esc(fillLine)}</span><span class="ask-chev">›</span></button>`;
  return `<button type="button" class="snap-strip" style="--snap-n:${cells.length}" onclick="return go('dashboard','${tab}')">${cells.map((c) => `<span class="snap-cell"><span class="snap-num">${c.num}</span><span class="snap-lbl">${esc(c.label)}</span></span>`).join("")}</button>`;
}

// The Ask Sig row (spec §4.1): opens Sig's guided flows.
function askSigRowHtml() {
  return `<button type="button" class="ask-sig" onclick="return openAgentSheet()">${SIG_AVATAR_HTML}<span class="ask-tx"><strong>Ask Sig</strong><span class="muted small">Walkthroughs and straight answers.</span></span><span class="ask-chev">›</span></button>`;
}

// Deadline helpers shared by the queue and the Visits screens.
function addBizDays(fromMs, n) {
  const d = new Date(fromMs);
  let added = 0;
  while (added < n) { d.setDate(d.getDate() + 1); const day = d.getDay(); if (day !== 0 && day !== 6) added++; }
  return d.getTime();
}
function dayName(iso) {
  const d = new Date(iso || "");
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "long" });
}
function dueDayWords(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(d) - start(new Date())) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 6) return "by " + dayName(iso);
  return "by " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// "Post due by Thursday; the week runs out Sunday" (spec §5.4).
function postDueLine(b) {
  if (!b.postDeadline) return "";
  const hard = (b.compliance && b.compliance.deadline) || new Date(Date.parse(b.postDeadline) + 5 * 86400000).toISOString();
  return `Post due by ${dayName(b.postDeadline)}; the week runs out ${dayName(hard)}.`;
}

// The standard post nudge (spec §5.4): one tap, standard
// wording, no free text. It sends as a normal message, so the
// conversation lives in the thread afterwards.
async function sendNudge(bookingId, btn) {
  const b = (state.nudgeBookings || {})[bookingId];
  if (!b) return false;
  if (btn) { btn.disabled = true; btn.textContent = "Sending"; }
  const first = (b.creatorName || "").trim().split(" ")[0] || "there";
  const biz = (state.user.business && state.user.business.businessName) || "We";
  const body = `Hi ${first}, ${biz} here on SIGNL. Thanks for visiting${b.redeemedAt ? ` on ${fmtDay(b.redeemedAt)}` : ""}. Your post is due by ${fmtDay(b.postDeadline)}: 1 post + 1 story that shares it. Shout if you need anything.`;
  try {
    await api("POST", "/messages", { toUserId: b.creatorId, body });
    if (btn) btn.textContent = "Nudge sent";
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = "Send a nudge"; }
    alert(err.message);
  }
  return false;
}

// ---------- V3 More, Settings, Help, Momentum, Earnings ----------

function renderMoreScreen() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  const rows = moreRowsFor();
  el.innerHTML = `
  ${wsHead("More", { sub: "The things you check, not the things you work.", subKey: "more" })}
  <div class="more-list">
    ${rows.map((r) => `<button type="button" class="more-row" onclick="return go('dashboard','${r.tab}')"><span class="more-ic">${bnIcon(r.icon)}</span><span class="more-tx"><span class="more-label">${esc(r.label)}</span><span class="more-sub">${esc(r.sub)}</span></span>${r.badge ? `<span class="tab-badge inline">${r.badge > 99 ? "99+" : r.badge}</span>` : ""}<span class="more-chev">›</span></button>`).join("")}
  </div>
  <button type="button" class="more-row logout" onclick="signOut()"><span class="more-ic">${bnIcon("signout")}</span><span class="more-tx"><span class="more-label">Log out</span></span></button>`;
}

function renderSettingsTab() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  const u = state.user;
  if (u.role !== "business") {
    el.innerHTML = `
  ${wsHead("Settings", { sub: "Account and notifications.", subKey: "settings" })}
  <div class="panel mt">
    <h3>Notifications</h3>
    <p class="small muted">SIGNL emails you when a business invites you, answers your application, or sends a license request. In-app badges count what is waiting on you. There are no notification switches yet; the emails are the record.</p>
  </div>
  <div class="panel mt">
    <h3>Payout details</h3>
    <p class="small muted">Paid bookings record your rate in the app: booked at your rate, you keep 97%. Payouts run outside the app for now, so there is nothing to set up here yet, and nothing in the app promises a payout date.</p>
  </div>
  ${accountHtml(u)}`;
    return;
  }
  const rl = u.business.reviewLinks || {};
  el.innerHTML = `
  ${wsHead("Settings", { sub: "Account, staff PIN, and the settings behind your offers.", subKey: "settings" })}
  <div class="panel mt tint" id="staff-settings">
    <h3>Staff redemption</h3>
    <p class="muted">Loading...</p>
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
  <div class="panel mt tint">
    <h3>Your referral program</h3>
    <p class="small muted">Already run a referral program in your booking or register system? Keep it, and let SIGNL feed it. Save your tracked referral link once and it rides on every opportunity and booked visit: creators see it on their cards and carry it in their posts, so the bookings land in the dashboard you already use. SIGNL never touches referral money, and any rewards stay yours to run, under your program's terms.</p>
    <div class="field"><label>Your tracked referral link</label><input id="rp-url" type="url" value="${esc(u.business.referralUrl || "")}" placeholder="https://your-booking-or-register-link"></div>
    <div class="form-2col">
      <div class="field"><label>Referral code (optional)</label><input id="rp-code" value="${esc(u.business.referralCode || "")}" placeholder="Your program's code, if it uses one"></div>
      <div class="field"><label>What it earns, in one line (optional)</label><input id="rp-note" maxlength="200" value="${esc(u.business.referralNote || "")}" placeholder="For example: Followers get 15% off a first visit; you earn $10 per booking"></div>
    </div>
    ${(u.business.referralUrl || u.business.referralCode) ? `<p class="small"><strong>Active:</strong> creators will see this on your opportunities and on their booked visits.</p>` : ""}
    <button class="btn" onclick="saveMyReferralProgram()">Save referral program</button> <span id="rp-ok" class="saved"></span>
  </div>
  <div class="panel mt">
    <h3>Audience code discount</h3>
    <p class="small muted">Every creator who visits you gets a personal audience code, and the code counts the customers their post sends you whether or not it carries a discount. A discount is entirely your choice: it is off unless you turn it on, and the percentage is yours to pick (5 to 50). Nothing is ever applied by default. New bookings carry the setting you save here; bookings already made keep the setting they were created with.</p>
    <label class="tgl-row"><input type="checkbox" class="sw" id="me-discount-enabled" ${u.business.discountEnabled ? "checked" : ""}><span>Offer a discount when customers use a creator's code</span></label>
    <div class="field" style="margin-top:8px"><label>Discount percent (%)</label><input type="number" id="me-discount-pct" min="5" max="50" step="1" value="${esc(String(u.business.discountPct == null ? ((state.boot.roasModel && state.boot.roasModel.suggestedDiscountPct) || 20) : u.business.discountPct))}"></div>
    <p class="small muted">Most businesses that turn this on start at ${esc(String((state.boot.roasModel && state.boot.roasModel.suggestedDiscountPct) || 20))}%. With codes off, the creator's card shows the code as a counting code and promises their audience nothing.</p>
    <button class="btn" onclick="saveMyDiscount()">Save code discount</button> <span id="disc-ok" class="saved"></span>
    <h3 class="mt">Your average ticket</h3>
    <p class="small muted">What one customer typically spends. Code-use estimates use this until you enter an actual tally on a visit.${u.business.averageTicket ? ` Your average ticket: $${fmtMoney(u.business.averageTicket)}.` : ""}</p>
    <div class="field"><label>Average ticket ($)</label><input type="number" id="me-avg-ticket" min="0" step="0.01" placeholder="40" value="${u.business.averageTicket ? esc(String(u.business.averageTicket)) : ""}"></div>
    <button class="btn" onclick="saveMyAverageTicket()">Save average ticket</button> <span id="ticket-ok" class="saved"></span>
  </div>
  <div class="panel mt">
    <h3>Notifications</h3>
    <p class="small muted">SIGNL emails you when a creator applies, a visit is booked, and a post lands. In-app badges count what is waiting on you. There are no notification switches yet; the emails are the record.</p>
  </div>
  ${accountHtml(u)}`;
  loadStaffSettings();
}

function renderHelpTab() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  const u = state.user;
  const biz = u.role === "business";
  const qa = (q, a) => `<details class="help-qa"><summary>${esc(q)}</summary><p class="small">${a}</p></details>`;
  el.innerHTML = `
  ${wsHead("Help", { sub: "How SIGNL works, in plain words.", subKey: "help" })}
  <div class="wcard">
  ${biz ? `
    ${qa("How does a visit work?", "You post an offer or invite a creator. When you select an applicant, or a creator accepts your invite, the visit is booked with a code. Your staff redeem the code at the register with the staff PIN. The creator posts within 48 hours to be on time; one week is the hard deadline.")}
    ${qa("What do I owe the creator?", "Exactly what the offer says: the comped meal or service, up to the dollar cap. Paid bookings pay the creator's listed rate instead.")}
    ${qa("Can I reuse a creator's post?", "A comped visit is native share only: reshare it with credit, nothing more. Paid bookings include one standard license: 90 days to repost and run ads. A comped post can be licensed at the creator's listed fee for 90 days; the creator approves each use and keeps 97%.")}
    ${qa("How fast do I have to answer applicants?", "Every applicant gets an answer within 2 business days. That is the deal. Anyone you do not pick is released with a note, never silence.")}
    ${qa("What if a creator does not show up?", esc(VISIT_GUARANTEE_LINE))}
    ${qa("What does SIGNL cost?", "Founding plans: Self-Service is $199 a month for 5 creators, Growth is $349 for 10, Managed is $699 for 20. Founding businesses get $100 off the first month and keep the founding rate while the plan stays active. The minimum is 3 months, there is no per-location charge, and unused visits roll into the next month, then expire.")}
  ` : `
    ${qa("What do I owe after a visit?", "One post plus one story that shares the post. Post within 48 hours to be on time; the hard deadline is one week. Always disclose the comp, that is the law and the deal.")}
    ${qa("How do comped visits and paid bookings differ?", "A comped visit covers the meal or service, on the business. A paid booking pays your listed rate, and you keep 97%. Joining is free and comped visits are always free; the only fee is 3% on paid bookings.")}
    ${qa("What is local reach?", "The share of your audience that actually lives here, times your audience size. Businesses rank creators by local reach, not follower count.")}
    ${qa("How does Momentum work?", "Points for doing the work well: +20 for an on-time post, +10 when a business approves you, +25 when you approve a license, +3 when someone joins from your invite link. Late posts and no-shows cost points.")}
    ${qa("What is a license request?", "A business asks to repost your post and run it as an ad for 90 days, at your listed licensing fee. You approve each use and keep 97%. It lives under Earnings.")}
    ${qa("When do I get paid?", "Paid bookings record your rate in the app: booked at your rate, you keep 97%. Payouts run outside the app for now, and nothing in the app promises a payout date.")}
  `}
  <p class="small muted" style="margin-top:14px">Still stuck? Email <a href="mailto:hello@joinsignl.com">hello@joinsignl.com</a> and a person answers.</p>
  </div>`;
}

function renderMomentumTab() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  const u = state.user;
  const m = u.momentum || { points: 0, checklist: [] };
  const tier = (u.creator && u.creator.tierBand) || "";
  const next = (m.checklist || []).find((i) => !i.done);
  el.innerHTML = `
  ${wsHead("Momentum", { sub: "Your points, your tier, and what earns more.", subKey: "momentum" })}
  <div class="wcard mom-card">
    <div class="kpi-label">Your Momentum</div>
    <div class="kpi-num" style="font-size:3rem">${fmtNum(m.points || 0)}</div>
    <div class="kpi-sub">${m.points ? `${tier ? `You are in the ${esc(tier)} tier. ` : ""}${next ? `Next: ${esc(next.label)} (+${next.points}).` : "Every way to earn is done. Keep the streak going."}` : "Your Momentum starts with your first visit. Post on time and it climbs."}</div>
  </div>
  ${momentumHtml(u)}
  ${growRosterHtml(u)}`;
}

// Creator Earnings (spec §6.5): real totals only, license
// requests decided on the row, booking history with states in
// words. Record language only while payments run off-app.
async function renderEarningsTab() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  el.innerHTML = `${wsHead("Earnings", { sub: "What your posts and visits have earned you.", subKey: "earnings" })}${skelHtml("Loading your earnings...", 2)}`;
  try {
    const [bkData, lrData] = await Promise.all([
      api("GET", "/bookings"),
      api("GET", "/license-requests").catch(() => ({ licenseRequests: [] })),
    ]);
    if (!document.getElementById("tab-body")) return;
    const bookings = bkData.bookings || [];
    const lrs = lrData.licenseRequests || [];
    state.licenseRequests = lrs;
    const money = homeMoney(bookings);
    const pending = lrs.filter((l) => l.status === "pending");
    const granted = lrs.filter((l) => l.status === "granted");
    const decided = lrs.filter((l) => l.status !== "pending");
    state.waitCounts = state.waitCounts || {};
    state.waitCounts.crLicense = pending.length;
    const licEarned = granted.reduce((s, l) => s + (Number(l.creatorNet) || 0), 0);
    const total = Math.round(((money.released || 0) + licEarned) * 100) / 100;
    const nowD = new Date();
    const inMonth = (iso) => { const d = new Date(iso || ""); return !Number.isNaN(d.getTime()) && d.getFullYear() === nowD.getFullYear() && d.getMonth() === nowD.getMonth(); };
    let monthEarned = 0;
    for (const b of bookings) if (b.paidLane && b.paidLane.escrowState === "released" && b.post && inMonth(b.post.firstAt || b.post.submittedAt)) monthEarned += Number(b.paidLane.creatorNet) || 0;
    for (const l of granted) if (inMonth(l.createdAt)) monthEarned += Number(l.creatorNet) || 0;
    const paidBookings = bookings.filter((b) => b.paidLane);
    const stateWord = (b) => b.paidLane.escrowState === "refunded" ? "Refunded" : b.post ? (b.paidLane.escrowState === "released" ? "Complete" : "Post live") : "Booked";
    const licRow = (l, withActions) => `<div class="lib-row"><div class="lib-main"><div class="lib-title">${esc(l.businessName || "A business")} wants to license your post</div><div class="lib-meta">Your fee $${fmtPrice(l.fee)} · you keep $${fmtMoney(l.creatorNet)} · 90 days of repost and ad use${l.postUrl ? ` · <a href="${esc(l.postUrl)}" target="_blank" rel="noopener">View post</a>` : ""}${l.status !== "pending" ? ` · ${l.status === "granted" ? "Approved" : "Declined"}` : ""}</div></div>${withActions ? `<span class="req-acts"><button type="button" class="btn small-btn ws-primary" onclick="return respondLicenseEarn('${l.id}','approve')">Approve</button> <button type="button" class="btn small-btn ws-outline" onclick="return respondLicenseEarn('${l.id}','decline')">Decline</button></span>` : ""}</div>`;
    el.innerHTML = `
  ${wsHead("Earnings", { sub: "What your posts and visits have earned you.", subKey: "earnings" })}
  ${total > 0 || paidBookings.length || granted.length ? `
  <div class="kpi-grid c3">
    ${kpiCard("Total earned", `$${fmtMoney(total)}`, { sub: "Paid bookings released, plus licenses you approved" })}
    ${kpiCard("This month", `$${fmtMoney(monthEarned)}`, { sub: "Earned in " + nowD.toLocaleDateString(undefined, { month: "long" }) })}
    ${kpiCard("On its way", `$${fmtMoney(money.held || 0)}`, { sub: "Booked at your rate, held until the post is live" })}
  </div>` : `
  <div class="empty-card"><div class="ec-t">Nothing earned yet</div><div class="ec-s">Nothing earned yet. Paid bookings you complete show up here. Comped visits build your Momentum instead.</div></div>`}
  <p class="small muted" style="margin:14px 2px 0">Paid bookings pay your listed rate. You keep 97%.</p>
  <h3 style="margin:22px 0 0">License requests</h3>
  ${pending.length ? `<div class="wcard" style="padding-top:8px;padding-bottom:8px">${pending.map((l) => licRow(l, true)).join("")}</div>` : `<p class="small muted" style="margin:8px 2px 0">No license requests waiting. When a business wants to reuse one of your posts, it lands here at your listed fee.</p>`}
  ${decided.length ? `<div class="wcard" style="padding-top:8px;padding-bottom:8px;margin-top:12px">${decided.map((l) => licRow(l, false)).join("")}</div>` : ""}
  <h3 style="margin:22px 0 0">Paid bookings</h3>
  ${paidBookings.length ? `<div class="wcard" style="padding-top:8px;padding-bottom:8px">${paidBookings.map((b) => `<div class="lib-row"><div class="lib-main"><div class="lib-title">${esc(b.title)}</div><div class="lib-meta">${esc(b.businessName || "")} · Booked at your rate of $${fmtPrice(b.paidLane.rate)}. You keep $${fmtMoney(b.paidLane.creatorNet)}.</div></div><span class="badge ${b.paidLane.escrowState === "released" ? "ok" : b.paidLane.escrowState === "refunded" ? "warn" : "info"}">${stateWord(b)}</span></div>`).join("")}</div>` : `<p class="small muted" style="margin:8px 2px 0">No paid bookings yet. Set your rate on your profile and businesses can book you paid.</p>`}`;
    renderBottomNav();
  } catch (err) {
    el.innerHTML = `${wsHead("Earnings")}<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function respondLicenseEarn(id, decision) {
  const rec = (state.licenseRequests || []).find((l) => l.id === id);
  if (decision === "approve" && rec && !confirm(`Approve this license? ${rec.businessName || "The business"} can repost this post and run it as an ad for 90 days. You keep $${fmtMoney(rec.creatorNet)} (97% of your fee).`)) return false;
  try { await api("POST", `/license-requests/${id}/respond`, { decision }); renderEarningsTab(); }
  catch (err) { alert(err.message); }
  return false;
}

// Creator analytics (amendment, 2026-10-27): "Your numbers"
// is the creator's Results — local reach with its composition,
// posts delivered and on-time %, the day 7/14/30 series,
// Momentum trend, and a reviews summary. Same honesty rules
// as business Results: real records only, fills-in states,
// no zero grids.
async function renderCreatorNumbers() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  const u = state.user;
  el.innerHTML = `${wsHead("Your numbers")}${skelHtml("Loading your numbers...", 2)}`;
  try {
    const [bkData, fData] = await Promise.all([
      api("GET", "/bookings").catch(() => ({ bookings: [] })),
      api("GET", "/me/founding").catch(() => ({ card: {} })),
    ]);
    if (!document.getElementById("tab-body")) return;
    const bookings = bkData.bookings || [];
    const card = fData.card || {};
    const p = card.profile || {};
    const tr = card.trackRecord || {};
    const totalAud = totalAudienceOf(card);
    const pctSet = !(p.localAudiencePct === null || p.localAudiencePct === undefined);
    const localReach = pctSet ? Math.round((totalAud * Number(p.localAudiencePct)) / 100) : null;
    const stack = stackList(card);
    const delivered = bookings.filter((b) => b.post);
    const m = u.momentum || { points: 0, ledger: [] };
    const head = wsHead("Your numbers", { sub: "Your creator program in numbers, all from your real records.", subKey: "cr-numbers" });
    const reachCard = `<div class="wcard">
      <div class="kpi-label">Your local reach</div>
      <div class="kpi-num" style="font-size:3.3rem">${localReach === null ? "Not set" : fmtNum(localReach)}</div>
      <div class="kpi-sub">${pctSet ? `${p.localAudiencePct}% of your ${fmtNum(totalAud)} audience lives in ${esc(marketTalkNameClient(u.market))}. That share is what businesses see first.` : "Set your local % on your profile and this becomes the number businesses rank you by."}</div>
      ${stack.length ? `<div class="stack-list">${stack.map((s) => `<div class="ui-row"><span class="k">${esc(s.label)}</span><span class="v">${fmtNum(s.count)}${pctSet ? ` · ${fmtNum(Math.round((s.count * Number(p.localAudiencePct)) / 100))} local` : ""}</span></div>`).join("")}</div>` : ""}
    </div>`;
    if (!bookings.length && !delivered.length && !(m.points > 0)) {
      el.innerHTML = `${head}
      ${reachCard}
      <div class="empty-card"><div class="ec-t">Your numbers</div><div class="ec-s">This fills in once your visits and posts land. When businesses book you and your posts go live, you will see your posts, your on-time record, and your Momentum here.</div></div>`;
      return;
    }
    const seriesRows = delivered.filter((b) => b.post && (b.post.snapshots || []).length).map((b) => {
      const snaps = [...b.post.snapshots].sort((x, y) => String(x.at) < String(y.at) ? -1 : 1);
      const base = Date.parse(b.post.firstAt || snaps[0].at);
      const atDay = (dd) => { let v = null; for (const s of snaps) { if (Date.parse(s.at) <= base + dd * 24 * 3600 * 1000) v = s.views; } return v === null || v === undefined ? "&mdash;" : fmtNum(v); };
      return `<tr><td>${esc(b.title)}</td><td>${atDay(7)}</td><td>${atDay(14)}</td><td>${atDay(30)}</td><td>${fmtNum(b.post.views || 0)}</td></tr>`;
    }).join("");
    const ledger = (m.ledger || []).slice().sort((a, b) => String(a.at || "") < String(b.at || "") ? -1 : 1);
    let trendHtml = "";
    if (ledger.length) {
      const days = [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      for (let i = 29; i >= 0; i--) {
        const dayStart = today.getTime() - i * 86400000;
        const cum = ledger.filter((e) => (Date.parse(e.at || "") || 0) < dayStart + 86400000).reduce((s, e) => s + (Number(e.points) || 0), 0);
        days.push({ date: new Date(dayStart).toISOString(), points: Math.max(cum, 0) });
      }
      if (days.some((dd) => dd.points > 0)) trendHtml = `<div class="chart-card"><h3>Momentum trend</h3><p class="wc-sub">Your points, day by day, last 30 days.</p>${lineChartSvg(days, [{ k: "points", color: "#006AFC" }])}</div>`;
    }
    const reviewRows = bookings.filter((b) => b.creatorReview).map((b) => `<div class="lib-row"><div class="lib-main"><div class="lib-title">${starsHtml(b.creatorReview.stars)} ${esc(String(b.creatorReview.stars))} — ${esc(b.title || "Visit")}</div><div class="lib-meta">${esc(b.businessName || "")}${b.creatorReview.createdAt ? ` · ${fmtDay(b.creatorReview.createdAt)}` : ""}${b.creatorReview.comment ? `<br>${esc(b.creatorReview.comment)}` : ""}</div></div></div>`).join("");
    el.innerHTML = `${head}
    ${reachCard}
    <div class="kpi-grid c3">
      ${kpiCard("Posts delivered", fmtNum(tr.postsDelivered || delivered.length), { sub: "Posts live from your visits" })}
      ${kpiCard("On time", tr.onTimePct === null || tr.onTimePct === undefined ? "New" : tr.onTimePct + "%", { sub: "Inside the 48 hour standard" })}
      ${kpiCard("Momentum", fmtNum(m.points || 0), { sub: "Points from on-time posts, invites and approvals" })}
    </div>
    ${trendHtml}
    ${seriesRows ? `<div class="wcard"><h3>Post performance, day 7 / 14 / 30</h3><table class="series-table"><tr><th>Post</th><th>Day 7</th><th>Day 14</th><th>Day 30</th><th>Latest views</th></tr>${seriesRows}</table><p class="ana-note">Views at each mark after the post, from the numbers on record. A dash means that mark has not been reported yet.</p></div>` : `<div class="wcard"><h3>Post performance</h3><p class="wc-sub" style="margin:4px 0 0">Your posts appear here once their first numbers are in, tracked at day 7, 14 and 30. We do not chart zeroes.</p></div>`}
    <div class="wcard"><h3>Reviews</h3>
      ${card.ratingCount >= 1 && card.ratingAvg !== null && card.ratingAvg !== undefined ? `<p style="margin:4px 0 10px">${starsHtml(card.ratingAvg)} <strong>${esc(String(card.ratingAvg))}</strong> from ${card.ratingCount} business${card.ratingCount === 1 ? "" : "es"}.</p>${reviewRows}` : `<p class="wc-sub" style="margin:4px 0 0">No reviews yet. Reviews come from completed visits.</p>`}
    </div>`;
  } catch (err) {
    el.innerHTML = `${wsHead("Your numbers")}<div class="error-box">${esc(err.message)}</div>`;
  }
}

// The creator Offers gate card (spec §6.2 / §8): the deck is
// replaced by this until the completion gate is finished.
function gateCardHtml(u) {
  const pc = u.profileCompletion;
  const missing = pc ? pc.items.filter((i) => i.required && !i.done) : [];
  return `<div class="empty-card gate-card"><div class="ec-t">Finish your profile to see offers near you.</div>
  ${missing.length ? `<div class="ec-s">Still needed:</div><ul class="gate-list">${missing.map((i) => `<li>${esc(i.label)}${i.detail ? ` <span class="muted">(${esc(i.detail)})</span>` : ""}</li>`).join("")}</ul>` : `<div class="ec-s">A few essentials are still missing on your profile.</div>`}
  <p class="center" style="margin-top:12px"><button class="btn ws-primary" onclick="return go('dashboard','Profile')">Finish profile</button></p></div>`;
}

// ---------- Overhaul V2 workspace scaffold (Grin grammar) ----------
// One huge one-word title, an underlined tab row, white hairline
// cards, one strong filled primary per toolbar. Every renderer
// below is presentation only; the numbers come from real payloads.

// Screen head: title + optional chip (Live pill / beta) + one
// gray subtitle line + optional action block under it.
function wsHead(title, opts) {
  const o = opts || {};
  // V3 (spec §2.1): the purpose line shows on first visits and
  // is collapsible thereafter — pass subKey and the line carries
  // a dismiss control; once dismissed it stays dismissed on
  // this device.
  const sub = o.sub && !(o.subKey && subSeen(o.subKey)) ? o.sub : "";
  return `<div class="ws-head"><h1 class="ws-title">${esc(title)}${o.chip || ""}</h1>${sub ? `<p class="ws-sub">${sub}${o.subKey ? ` <button type="button" class="sub-x" onclick="return dismissSub('${o.subKey}', this)" aria-label="Got it">×</button>` : ""}</p>` : ""}${o.action ? `<div class="ws-action">${o.action}</div>` : ""}</div>`;
}
function subSeen(key) { try { return localStorage.getItem("signl-sub-" + key) === "1"; } catch (e) { return false; } }
function dismissSub(key, btn) {
  try { localStorage.setItem("signl-sub-" + key, "1"); } catch (e) { /* private mode */ }
  const p = btn && btn.closest ? btn.closest(".ws-sub") : null;
  if (p) p.remove();
  return false;
}
function livePill(text) { return `<span class="live-pill"><i></i>${esc(text || "Live")}</span>`; }

// Underlined tab row. items: {label, count, on, onclick}.
function wsTabs(items) {
  return `<div class="ws-tabs" role="tablist">${items.map((it) => `<button type="button" role="tab" aria-selected="${it.on ? "true" : "false"}" class="ws-tab ${it.on ? "on" : ""}" onclick="${it.onclick}">${esc(it.label)}${it.count != null ? `<span class="cnt">${it.count}</span>` : ""}</button>`).join("")}</div>`;
}

// Honest period delta: renders ONLY when both windows have real
// counts and the prior window is non-zero. Anything else returns
// "" and the KPI stands on its count alone — no invented %.
function deltaPill(cur, prev, label) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (!p) return "";
  const pct = Math.round(((c - p) / p) * 100);
  if (pct === 0) return `<span class="delta-pill flat">— no change ${label || "vs prior period"}</span>`;
  return `<span class="delta-pill ${pct < 0 ? "down" : ""}">${pct > 0 ? "↗" : "↘"} ${pct > 0 ? "+" : ""}${pct}% ${label || "vs prior period"}</span>`;
}

function kpiCard(label, numHtml, opts) {
  const o = opts || {};
  return `<div class="kpi-card"><div class="kpi-label">${esc(label)}</div><div class="kpi-num">${numHtml}</div>${o.sub ? `<div class="kpi-sub">${o.sub}</div>` : ""}${o.delta || ""}</div>`;
}

// iOS-style segmented switch. options: {v, label}; current value;
// fn is a global function name called with the value.
function segSw(options, current, fn) {
  return `<span class="segsw">${options.map((o) => `<button type="button" class="${o.v === current ? "on" : ""}" onclick="${fn}('${o.v}')">${esc(o.label)}</button>`).join("")}</span>`;
}

function fmtDayFull(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date(); const yday = new Date(Date.now() - 86400000);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Date-grouped event list (Grin Feed pattern). events:
// {at, title, meta, initial, acc, act:{label, onclick}} — sorted
// newest first by the caller; groups render in encounter order.
function feedListHtml(events) {
  if (!events || !events.length) return "";
  let lastDay = "";
  const rows = events.map((e) => {
    const day = fmtDayFull(e.at);
    const head = day && day !== lastDay ? `<div class="feed-day">${esc(day)}</div>` : "";
    lastDay = day;
    return `${head}<div class="feed-row"><span class="feed-dot ${e.acc ? "acc" : ""}">${e.icon ? bnIcon(e.icon) : esc(e.initial || "•")}</span><div class="feed-main"><div class="feed-title">${e.title}</div><div class="feed-meta">${esc(e.meta || "")}${e.at ? ` · ${esc(fmtTime(e.at))}` : ""}</div></div>${e.act ? `<span class="feed-act"><button type="button" class="btn small-btn ws-outline" onclick="${e.act.onclick}">${esc(e.act.label)}</button></span>` : ""}</div>`;
  }).join("");
  return `<div class="feed-list">${rows}</div>`;
}

// Minimal line chart over a daily series (dashed gridlines, one
// accent line per key, no axes beyond first/last date). Honest by
// construction: it plots exactly the values it is given.
function lineChartSvg(series, keys, h) {
  const W = 640, H = h || 170, PL = 6, PR = 6, PT = 10, PB = 20;
  if (!series || !series.length) return "";
  let max = 0;
  for (const row of series) for (const k of keys) max = Math.max(max, Number(row[k.k]) || 0);
  const top = Math.max(max, 1);
  const x = (i) => PL + (i * (W - PL - PR)) / Math.max(series.length - 1, 1);
  const y = (v) => PT + (1 - v / top) * (H - PT - PB);
  const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line x1="${PL}" x2="${W - PR}" y1="${y(top * f)}" y2="${y(top * f)}" stroke="#DFE7DF" stroke-width="1" stroke-dasharray="4 5"/>`).join("");
  const lines = keys.map((k) => {
    const pts = series.map((row, i) => `${x(i).toFixed(1)},${y(Number(row[k.k]) || 0).toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${k.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join("");
  const d0 = series[0].date ? fmtDay(series[0].date) : "";
  const d1 = series[series.length - 1].date ? fmtDay(series[series.length - 1].date) : "";
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart, peak ${top}">${grid}${lines}<text x="${PL}" y="${H - 5}" font-size="11" fill="#7C877C" font-weight="600">${esc(d0)}</text><text x="${W - PR}" y="${H - 5}" font-size="11" fill="#7C877C" font-weight="600" text-anchor="end">${esc(d1)}</text></svg>`;
}
function barsChartSvg(series, key, color, h) {
  const W = 640, H = h || 170, PL = 6, PR = 6, PT = 10, PB = 20;
  if (!series || !series.length) return "";
  let max = 0;
  for (const row of series) max = Math.max(max, Number(row[key]) || 0);
  const top = Math.max(max, 1);
  const bw = (W - PL - PR) / series.length;
  const bars = series.map((row, i) => {
    const v = Number(row[key]) || 0;
    const bh = Math.max((v / top) * (H - PT - PB), v > 0 ? 3 : 0);
    return `<rect x="${(PL + i * bw + 1.5).toFixed(1)}" y="${(H - PB - bh).toFixed(1)}" width="${Math.max(bw - 3, 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="2.5" fill="${color}"/>`;
  }).join("");
  const grid = [0.5, 1].map((f) => `<line x1="${PL}" x2="${W - PR}" y1="${(PT + (1 - f) * (H - PT - PB)).toFixed(1)}" y2="${(PT + (1 - f) * (H - PT - PB)).toFixed(1)}" stroke="#DFE7DF" stroke-width="1" stroke-dasharray="4 5"/>`).join("");
  const d0 = series[0].date ? fmtDay(series[0].date) : "";
  const d1 = series[series.length - 1].date ? fmtDay(series[series.length - 1].date) : "";
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chart, peak ${top}">${grid}${bars}<text x="${PL}" y="${H - 5}" font-size="11" fill="#7C877C" font-weight="600">${esc(d0)}</text><text x="${W - PR}" y="${H - 5}" font-size="11" fill="#7C877C" font-weight="600" text-anchor="end">${esc(d1)}</text></svg>`;
}

// The V2 funnel: big stage numbers, plain-language captions,
// accent progress bars. stages: {label, n, cap}.
function funnel2Html(stages) {
  const top = Math.max(...stages.map((s) => s.n || 0), 1);
  return stages.map((s) => `<div class="fn2-row"><span class="fn2-stage">${esc(s.label)}</span><span class="fn2-num">${fmtNum(s.n || 0)}</span><span class="fn2-cap">${esc(s.cap)}</span><span></span><span class="fn2-bar"><i style="width:${Math.round(((s.n || 0) / top) * 100)}%"></i></span></div>`).join("");
}
function wireReady(root) {
  if (!root || !state.agentQueue) return;
  root.querySelectorAll("[data-rq]").forEach((btn) => {
    btn.onclick = () => {
      const r = state.agentQueue && state.agentQueue.rows[Number(btn.getAttribute("data-rq"))];
      closeAgentSheet();
      if (r && r.act) r.act();
    };
  });
}
function openAgentSheet() {
  // Ask Sig (V3, spec §4.1): guided flows that walk you to the
  // exact screen, plus straight answers from SIGNL's locked
  // facts. Sig never completes a consequential action here;
  // every flow lands you on the screen where you tap it.
  closeAgentSheet();
  const u = state.user;
  if (!u) return false;
  const biz = u.role === "business";
  const live = biz ? businessAccessState(u) === "active" : !!(u.founding && u.founding.marketLive);
  const flow = (label, act) => ({ label, act });
  const flows = biz ? [
    flow("Post an offer", () => go("dashboard", "My Offers")),
    flow("Review applicants", () => { state.offersSeg = "applicants"; go("dashboard", "My Offers"); }),
    flow("Find creators", () => go("dashboard", "Discover")),
    flow("Redeem a visit", () => go("dashboard", "Counter")),
    flow("Set the staff PIN", () => go("dashboard", "Settings")),
    flow("See your results", () => go("dashboard", "Analytics")),
  ] : live ? [
    flow("See offers near you", () => go("dashboard", "Offers")),
    flow("Answer an invite", () => { state.crOffersSeg = "invited"; go("dashboard", "Offers"); }),
    flow("Add a post link", () => { state.visitsSeg = "needs"; go("dashboard", "My Visits"); }),
    flow("See my earnings", () => go("dashboard", "Earnings")),
    flow("Check my Momentum", () => go("dashboard", "Momentum")),
    flow("Finish my profile", () => go("dashboard", "Profile")),
  ] : [
    flow("Finish my profile", () => go("dashboard", "Profile")),
    flow("Check my Momentum", () => go("dashboard", "Momentum")),
  ];
  const qa = (q, a) => `<details class="help-qa"><summary>${esc(q)}</summary><p class="small">${a}</p></details>`;
  const el = document.createElement("div");
  el.id = "agent-sheet";
  el.className = "sheet-overlay";
  el.innerHTML = `
  <div class="sheet" role="dialog" aria-label="Ask Sig">
    <div class="flex-between"><span class="sig-top" style="gap:10px">${SIG_AVATAR_HTML}<strong>Ask Sig</strong></span><button class="linklike" onclick="closeAgentSheet()">Close</button></div>
    <p class="small muted" style="margin:8px 0 4px">Tell Sig what you want to do. Sig walks you to the exact screen.</p>
    ${flows.map((f, i) => `<button type="button" class="sheet-row ask-flow" data-flow="${i}"><span>${esc(f.label)}</span><span class="ask-chev">›</span></button>`).join("")}
    <h4 style="margin:16px 0 4px">Straight answers</h4>
    ${biz ? `
    ${qa("What does SIGNL cost?", "Founding plans: Self-Service is $199 a month for 5 creators, Growth is $349 for 10, Managed is $699 for 20. Founding businesses get $100 off the first month and keep the founding rate while the plan stays active. The minimum is 3 months, there is no per-location charge, and unused visits roll into the next month, then expire.")}
    ${qa("Can I reuse a creator's post?", "A comped visit is native share only: reshare it with credit, nothing more. Paid bookings include one standard license: 90 days to repost and run ads. A comped post can be licensed at the creator's listed fee for 90 days; the creator approves each use and keeps 97%.")}
    ${qa("How fast do I have to answer applicants?", "Every applicant gets an answer within 2 business days. That is the deal.")}
    ${qa("What if a creator does not show up?", esc(VISIT_GUARANTEE_LINE))}
    ` : `
    ${qa("What do I owe after a visit?", "One post plus one story that shares the post. Post within 48 hours to be on time; the hard deadline is one week.")}
    ${qa("How does Momentum work?", "Points for doing the work well: +20 for an on-time post, +10 when a business approves you, +25 when you approve a license, +3 when someone joins from your invite link.")}
    ${qa("What is local reach?", "The share of your audience that actually lives here, times your audience size. Businesses rank creators by local reach, not follower count.")}
    ${qa("When do I get paid?", "Paid bookings record your rate in the app: booked at your rate, you keep 97%. Payouts run outside the app for now, and nothing in the app promises a payout date.")}
    `}
  </div>`;
  el.addEventListener("click", (e) => { if (e.target === el) closeAgentSheet(); });
  document.body.appendChild(el);
  el.querySelectorAll("[data-flow]").forEach((btn) => {
    btn.onclick = () => { const f = flows[Number(btn.getAttribute("data-flow"))]; closeAgentSheet(); if (f && f.act) f.act(); };
  });
  return false;
}
function closeAgentSheet() {
  const el = document.getElementById("agent-sheet");
  if (el) el.remove();
  return false;
}

// Generic home segments (same grammar as the business dashSegs):
// buttons switch [data-seg] panels inside the [data-dash] root.
function homeSegsHtml(segs) {
  return `<div class="view-toggle dash-segs"><div class="vt-group">${segs.map(([id, label, badge], i) => `<button type="button" class="rchip${i === 0 ? " on" : ""}" data-segbtn="${id}" onclick="dashSeg('${id}', this)">${label}${badge ? ` <span class="seg-badge">${badge}</span>` : ""}</button>`).join("")}</div></div>`;
}
// Segmented panel switch for the analytics toggles (funnel
// window, content library) — same show/hide grammar as dashSeg.
function segPanels(btn, panelAttr, val, btnAttr) {
  const root = btn && btn.closest ? btn.closest("[data-dash]") : null;
  if (!root) return false;
  root.querySelectorAll(`[${panelAttr}]`).forEach((p) => { p.hidden = p.getAttribute(panelAttr) !== String(val); });
  root.querySelectorAll(`[${btnAttr}]`).forEach((b) => b.classList.toggle("on", b.getAttribute(btnAttr) === String(val)));
  return false;
}
function bizFnWin(days, btn) { return segPanels(btn, "data-fnp", days, "data-fnbtn"); }
function bizLibTab(which, btn) { return segPanels(btn, "data-libp", which, "data-libbtn"); }
// Feed filter chips: hide cards whose data-fk does not match.
function feedChip(btn, kind) {
  const root = btn && btn.closest ? btn.closest("[data-dash]") : null;
  if (!root) return false;
  root.querySelectorAll("[data-fcbtn]").forEach((b) => b.classList.toggle("on", b === btn));
  root.querySelectorAll("[data-fk]").forEach((c) => { c.hidden = kind !== "all" && c.getAttribute("data-fk") !== kind; });
  return false;
}
// Offer template cards (Offers segment): land in the composer
// with the lane preset. A draft the business already started is
// never overwritten — the same rule as the two-tap prefill.
function startOfferTemplate(kind) {
  state.offerTarget = null;
  state.composerLane = "open";
  if (offerDraftIsEmpty()) state.offerDraft.kind = kind === "paid" ? "paid" : "comp";
  state.tab = "My Offers";
  render();
  return false;
}

// License state pill for a delivered post (content library):
// derived server-side from the visit's own terms.
function licPillHtml(lic) {
  if (!lic || lic.type === "native") return `<span class="lic-pill">Native share only</span>`;
  const label = lic.type === "licensed" ? "Licensed" : "Standard license";
  if (lic.daysLeft === null || lic.daysLeft === undefined) return `<span class="lic-pill live">${label}</span>`;
  if (lic.daysLeft < 0) return `<span class="lic-pill over">${label} ended</span>`;
  return `<span class="lic-pill live">${label} · ${lic.daysLeft}d left</span>`;
}
// Business funnel with the 7/30-day segmented toggle. Falls back
// to the cumulative pipeline when windowed counts are absent.
function bizFunnelHtml(h) {
  const stage = (n, l, s) => `<div class="pv-stage"><div class="pv-stage-num">${n}</div><div class="pv-stage-lbl">${l}</div><div class="pv-stage-sub">${s}</div></div>`;
  const fun = (f) => `<div class="pv-funnel">${stage(f.invited, "Invited", "Bookings created")}${stage(f.claimed, "Claimed", "Codes issued")}${stage(f.visited, "Visited", "Redeemed in store")}${stage(f.posted, "Posted", "Posts reported live")}</div>`;
  if (h.funnel7 && h.funnel30) {
    return `<div class="view-toggle lib-toggle"><div class="vt-group"><button type="button" class="rchip" data-fnbtn="7" onclick="return bizFnWin(7, this)">7 days</button><button type="button" class="rchip on" data-fnbtn="30" onclick="return bizFnWin(30, this)">30 days</button></div></div><div data-fnp="7" hidden>${fun(h.funnel7)}</div><div data-fnp="30">${fun(h.funnel30)}</div>`;
  }
  const p = h.pipeline || { invited: 0, claimed: 0, clockRunning: 0, live: 0 };
  return `<div class="pv-funnel">${stage(p.invited, "Invited", "Bookings created")}${stage(p.claimed, "Claimed", "Codes issued")}${stage(p.clockRunning, "Visited", "Visits redeemed")}${stage(p.live, "Posted", "Posts delivered")}</div><p class="ana-note">All-time pipeline. Windowed counts arrive with your first full week of visits.</p>`;
}
// Content library: every delivered post with its license state,
// split into the creator's posts and the ones the business can
// actually use. Rights follow the visit, never the plan.
function bizLibraryHtml(h) {
  const lib = h.contentLibrary || [];
  if (!lib.length) return `<div class="feed-empty"><strong>No posts yet</strong>Delivered posts land here with their license state.</div>`;
  const row = (r) => `<div class="lib-row"><div class="lib-main"><div class="lib-title">${esc(r.title)}</div><div class="lib-meta">@${esc(r.creatorHandle)} · ${r.postedAt ? fmtDay(r.postedAt) : ""} · ${fmtNum(r.views)} views · ${r.onTime ? "on time" : "late"}${r.redemptions ? ` · ${r.redemptions.count} code uses · $${fmtMoney(r.redemptions.basketTotal)} rung up` : ""}</div></div>${licPillHtml(r.license)}${r.postUrl ? `<a class="btn small-btn ghost" href="${esc(r.postUrl)}" target="_blank" rel="noopener">View post</a>` : ""}</div>`;
  const yours = lib.filter((r) => r.license && r.license.type !== "native");
  return `<div class="view-toggle lib-toggle"><div class="vt-group"><button type="button" class="rchip on" data-libbtn="creator" onclick="return bizLibTab('creator', this)">Creator posts</button><button type="button" class="rchip" data-libbtn="yours" onclick="return bizLibTab('yours', this)">Yours to use</button></div></div>
  <div data-libp="creator"><p class="small muted">Seeing a post here is not the right to reuse it. Comped posts are native share only, with credit, unless you license them from the creator.</p>${lib.map(row).join("")}</div>
  <div data-libp="yours" hidden><p class="small muted">Posts you can repost and run as ads inside the window shown. The window runs 90 days from the post date.</p>${yours.length ? yours.map(row).join("") : `<div class="feed-empty"><strong>Nothing licensed yet</strong>Paid bookings carry a 90-day standard license. A comped post can be licensed at the creator's listed fee.</div>`}</div>`;
}
// Offers-segment template cards, in SIGNL's own terms.
function bizTemplatesHtml() {
  const card = (kind, icon, name, desc) => `<div class="tmpl-card"><div class="tmpl-tile">${bnIcon(icon)}</div><div class="tmpl-name">${name}</div><div class="tmpl-desc">${desc}</div><button type="button" class="btn small-btn" onclick="return startOfferTemplate('${kind}')">Start</button></div>`;
  return `<div class="tmpl-grid">${card("comp", "offers", "Comped visit", "You cover the meal or service. The creator posts honestly within 48 hours.")}${card("paid", "visits", "Paid booking", "Book at the creator's listed rate. They keep 97%, and a 90-day license is included.")}${card("open", "join", "Open call", "Post it to your market and let matching creators apply. You pick from the stack.")}</div>`;
}
// Activity feed cards from delivered posts + their licenses.
function bizActivityFeedHtml(h) {
  const lib = h.contentLibrary || [];
  if (!lib.length) return `<div class="feed-empty"><strong>Nothing here yet</strong>Posts and licenses land here as visits complete.</div>`;
  const cards = [];
  for (const r of lib) {
    cards.push(`<div class="feed-card" data-fk="posts"><div class="feed-dot">${bnIcon("visits")}</div><div class="feed-main"><div class="feed-title">Post live: ${esc(r.title)}</div><div class="feed-meta">@${esc(r.creatorHandle)} · ${r.postedAt ? fmtDay(r.postedAt) : ""} · ${fmtNum(r.views)} views · ${r.onTime ? "on time" : "late"}</div></div>${r.postUrl ? `<span class="feed-act"><a class="btn small-btn ghost" href="${esc(r.postUrl)}" target="_blank" rel="noopener">View post</a></span>` : ""}</div>`);
    if (r.license && r.license.type !== "native") {
      cards.push(`<div class="feed-card" data-fk="licenses"><div class="feed-dot acc">${bnIcon("offers")}</div><div class="feed-main"><div class="feed-title">${r.license.type === "licensed" ? "Licensed post" : "Standard license"}: ${esc(r.title)}</div><div class="feed-meta">${r.license.daysLeft === null || r.license.daysLeft === undefined ? "90-day window from the post date" : r.license.daysLeft < 0 ? "The reuse window has ended" : `${r.license.daysLeft} days left to repost and run ads`}</div></div><span class="feed-act"><button type="button" class="btn small-btn ghost" onclick="return go('dashboard','Visits &amp; Posts')">Open</button></span></div>`);
    }
  }
  return `<div class="feed-chips"><button type="button" class="chip on" data-fcbtn onclick="return feedChip(this,'all')">All</button><button type="button" class="chip" data-fcbtn onclick="return feedChip(this,'posts')">Posts</button><button type="button" class="chip" data-fcbtn onclick="return feedChip(this,'licenses')">Licenses</button></div>${cards.join("")}`;
}

function go(view, tab) {
  // Any navigation leaves Business Preview: the mode is a single
  // deliberate walk, and the admin lands back on the normal console.
  if (state.preview) { stopPreviewCountdown(); state.preview = null; }
  stopHomeCountdown();
  // Flush the deferred notification read (see loadNotificationsInto):
  // leaving the dashboard marks its Updates read and clears the badges.
  if (state.notesReadPending) {
    state.notesReadPending = false;
    api("POST", "/notifications/read", {}).then(() => refreshBadges()).catch(() => {});
  }
  state.view = view;
  if (tab) state.tab = tab;
  render();
  return false;
}

async function render() {
  // The Ready-for-you queue belongs to the home that computed it;
  // every navigation clears it and the new home re-registers.
  state.agentQueue = null;
  renderAgentFab();
  renderNav();
  if (state.view === "public-profile") return renderPublicProfile();
  if (state.view === "public-proof") return renderPublicProof();
  clearShareShell();
  if (state.view === "staff") return renderStaff();
  const u = state.user;
  if (!u) {
    if (state.view === "join-creator") return renderJoinCreator();
    if (state.view === "for-businesses" || state.view === "join-business") return renderForBusinesses();
    if (state.view === "signin") return renderSignin();
    if (state.view === "forgot") return renderForgot();
    if (state.view === "reset") return renderReset();
    return renderHome();
  }
  if (u.status === "pending") return u.role === "business" ? renderBusinessFoundingStatus() : renderPending();
  if (u.status === "rejected") return renderRejected();
  if (isFoundingBusiness(u)) return renderBusinessFoundingStatus();
  return renderDashboard();
}

// ---------------- logged-out views ----------------

function renderHome() {
  app.innerHTML = `
  <section class="hero">
    <h1>Local creators.<br><span class="grad-text">Real regulars.</span></h1>
    <p>Local businesses comp a meal or a service. A local creator posts honestly within 48 hours. Every visit tracked.</p>
    <p><strong>${CREATOR_FREE_LINE}</strong></p>
    <div class="cta-row">
      <a class="btn" href="#" onclick="return go('join-creator')">Become a Founding Creator</a>
      <a class="btn ghost" href="#" onclick="return go('for-businesses')">For Businesses</a>
      <a class="btn ghost" href="#" onclick="return goStaff()">Redeem a creator visit</a>
    </div>
    <p class="small muted mt">Founding sign-ups open in all ${(state.boot && state.boot.markets ? state.boot.markets.length : 37)} markets &middot; Decisions within 2 business days</p>
  </section>
  <section style="margin-top:44px">
    <p class="ui-kicker">How it works</p>
    <div class="srow"><div class="snum">01</div><div><div class="stitle">Claim your spot</div><div class="swhis">Handle, market, email — about a minute.</div></div></div>
    <div class="srow"><div class="snum">02</div><div><div class="stitle">Your market opens</div><div class="swhis">We email you. Businesses see local reach first.</div></div></div>
    <div class="srow"><div class="snum">03</div><div><div class="stitle">Visit. Post honestly.</div><div class="swhis">Comped visit &middot; post within 48 hours.</div></div></div>
  </section>
  <section style="margin-top:40px">
    <p class="ui-kicker">The two lanes</p>
    <h2 style="margin:6px 0 4px">Comped, or <span style="color:var(--mint-deep)">paid.</span></h2>
    <div class="lrow"><span class="tg"></span><div><span class="lname">Comped visits</span> <span class="lline">— the business covers it. You post honestly within 48 hours.</span></div></div>
    <div class="lrow"><span class="tg off"></span><div><span class="lname">Paid bookings</span> <span class="lline">— booked at your rate. You keep 97%.</span></div></div>
  </section>
  <section class="fld fld-mint" style="margin-top:52px">
    <p class="ui-kicker">The rules</p>
    <h2 style="margin:8px 0 18px">Honest posts, <span class="acc">always.</span></h2>
    <div class="black-card">
      <div class="rule-row">No required praise, ever.</div>
      <div class="rule-row">Every comp disclosed (FTC).</div>
      <div class="rule-row">Posts delivered in 48 hours*</div>
      <p class="small muted" style="margin:10px 0 0">*Creators have up to a week; 48 hours is the standard they are held to. A visit with no post after the week is replaced for the business.</p>
      <details class="deal-details"><summary>All the rules</summary><div class="dd-body"><p class="small">A business can never require a positive post, a rating, or specific words. Creators disclose every comp, as the FTC requires. A post inside the week still counts, as a late delivery. Invite other creators and earn Momentum points (+3 per sign-up through your link, +10 per approval). Points order the creator list businesses see.</p></div></details>
    </div>
  </section>`;
}

function unlistedLabel() {
  return (state.boot && state.boot.unlistedMarket) || "Not listed yet";
}

// Listed label for a market (Jeff, 2026-10-23): the record keeps
// the canonical name ("Virginia Beach"); labels read
// "Virginia Beach (Hampton Roads)" from the bootstrap label. The
// value submitted and stored never changes.
function marketDisplayName(name) {
  const m = state.boot && state.boot.markets ? state.boot.markets.find((x) => x.name === name) : null;
  return (m && m.label) || name;
}

// Conversational name for the Virginia Beach market in creator
// and business prose (Jeff, 2026-10-23): talk says Hampton Roads.
function marketTalkNameClient(name) {
  return name === "Virginia Beach" ? "Hampton Roads" : name;
}

// "City, Country" for an unlisted creator. Records from before the
// country field fall back to their stored state, so nobody's place
// loses its second half.
function unlistedPlace(rec) {
  const region = rec.country || rec.state || "";
  return `${rec.city || ""}${region ? ", " + region : ""}`;
}

// Typed-city resolution (Jeff, 2026-10-23): when intake resolved
// the typed city into a market, the pending screen says so in one
// line, so a creator who typed Portsmouth learns they are filed
// under the Virginia Beach market instead of parked as
// "not listed". Conversation about that market says Hampton
// Roads (Jeff, 2026-10-23), so its towns read that way here.
function marketResolvedNote(u) {
  if (!u || u.marketResolvedFrom !== "typed_city" || !u.market || u.market === unlistedLabel()) return "";
  const city = u.marketResolvedCity || u.city || "";
  if (!city) return "";
  if (u.market === "Virginia Beach") return `<p><span class="badge info">${esc(city)} is part of Hampton Roads, so you're filed there.</span></p>`;
  return `<p><span class="badge info">${esc(city)} is part of our ${esc(u.market)} market, so you're filed there.</span></p>`;
}

// Display spelling of a typed city for the candidate prompt: the
// record keeps the typed value verbatim ("Portsmouth, United
// States"); the prompt reads better without the country suffix.
function typedCityDisplay(rec) {
  return String((rec && rec.city) || "").replace(/,\s*(united states|usa)$/i, "");
}

// One tap on an ambiguous intake's candidate metro: files the
// record under it through the pending market endpoint, which
// keeps the typed city as the home city.
async function pickCandidateMarket(e, market) {
  if (e) e.preventDefault();
  try {
    const data = await api("POST", "/me/market", { market });
    state.user = data.user;
    render();
  } catch (err) { alert(err.message); }
  return false;
}

// Market options are grouped by country (United States first, then the
// rest alphabetically), cities alphabetical inside each country, so the
// picker stays scannable as SIGNL goes universal (37 markets, 2026-10-18).
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
  <section class="panel form-panel" style="max-width:460px;margin:30px auto">
    <div class="form-head">
    <h2>Sign in</h2>
    </div>
    <div class="form-body">
    <div id="form-error"></div>
    <form onsubmit="return doSignin(event)">
      <div class="field"><label>Email</label><input type="email" id="si-email" required autocomplete="email"></div>
      <div class="field"><label>Password</label><input type="password" id="si-password" required autocomplete="current-password"></div>
      <button class="btn" type="submit" style="width:100%">Sign in</button>
    </form>
    <p class="small muted mt">You will stay signed in on this device for 30 days. <a href="#" onclick="return go('forgot')">Forgot password?</a></p>
    <button class="btn ghost mt" style="width:100%" onclick="return goStaff()">Redeem a creator visit</button>
    <p class="small muted">Staff at a SIGNL business: the button above takes you straight to the register screen. PIN in, creator code in, redeemed.</p>
    <p class="small muted mt">New to SIGNL? <a href="#" onclick="return go('join-creator')">Join as a founding creator</a>. Businesses: <a href="#" onclick="return go('for-businesses')">join the founding business list</a>.</p>
    </div>
  </section>`;
}

async function doSignin(e) {
  e.preventDefault();
  const form = e.target;
  if (!submitBusy(form, true)) return false;
  try {
    const data = await api("POST", "/auth/login", {
      email: document.getElementById("si-email").value,
      password: document.getElementById("si-password").value,
    });
    state.user = data.user;
    state.view = "dashboard";
    render();
    refreshBadges();
  } catch (err) {
    submitBusy(form, false);
    document.getElementById("form-error").innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

// Forgot password (UX audit fix, 2026-10-22): the request screen
// always lands on the same neutral confirmation, whether or not
// the email belongs to an account, so the form never confirms
// that an account exists.
function renderForgot() {
  app.innerHTML = `
  <section class="panel form-panel" style="max-width:460px;margin:30px auto">
    <div class="form-head">
    <h2>Forgot password</h2>
    </div>
    <div class="form-body">
    <p class="muted">Enter the email on your SIGNL account and we will email you a link to set a new password. The link works once and expires in one hour.</p>
    <div id="form-error"></div>
    <form onsubmit="return doForgot(event)">
      <div class="field"><label>Email</label><input type="email" id="fp-email" required autocomplete="email"></div>
      <button class="btn" type="submit" style="width:100%">Email me a reset link</button>
    </form>
    <p class="small muted mt">Remembered it after all? <a href="#" onclick="return go('signin')">Back to sign in</a>.</p>
    </div>
  </section>`;
}

async function doForgot(e) {
  e.preventDefault();
  const form = e.target;
  if (!submitBusy(form, true)) return false;
  try {
    await api("POST", "/auth/forgot", { email: document.getElementById("fp-email").value });
    app.innerHTML = `
    <section class="panel center" style="max-width:460px;margin:30px auto">
      <h2>Check your email</h2>
      <p>If an account exists for that email, a reset link is on its way. The link works once and expires in one hour.</p>
      <p class="muted">Nothing arrived after a few minutes? Check spam, then request a fresh link.</p>
      <div class="cta-row" style="justify-content:center">
        <a class="btn" href="#" onclick="return go('forgot')">Request another link</a>
        <a class="btn ghost" href="#" onclick="return go('signin')">Back to sign in</a>
      </div>
    </section>`;
  } catch (err) {
    submitBusy(form, false);
    document.getElementById("form-error").innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

// The reset screen the email link lands on (/?reset=<token>).
function renderReset() {
  app.innerHTML = `
  <section class="panel form-panel" style="max-width:460px;margin:30px auto">
    <div class="form-head">
    <h2>Set a new password</h2>
    </div>
    <div class="form-body">
    <p class="muted">Pick a new password for your SIGNL account. Setting it signs out every other device on the account.</p>
    <div id="form-error"></div>
    <form onsubmit="return doReset(event)">
      <div class="field"><label>New password (10+ characters)</label><input type="password" id="rs-password" required minlength="10" autocomplete="new-password"></div>
      <div class="field"><label>New password again</label><input type="password" id="rs-password2" required minlength="10" autocomplete="new-password"></div>
      <button class="btn" type="submit" style="width:100%">Set my new password</button>
    </form>
    <p class="small muted mt">Link expired or already used? <a href="#" onclick="return go('forgot')">Request a new one</a>.</p>
    </div>
  </section>`;
}

async function doReset(e) {
  e.preventDefault();
  const form = e.target;
  const errBox = (msg) => { document.getElementById("form-error").innerHTML = `<div class="error-box">${esc(msg)}</div>`; };
  const pw = document.getElementById("rs-password").value;
  if (pw !== document.getElementById("rs-password2").value) { errBox("The two passwords do not match. Type the same new password in both boxes."); return false; }
  if (!submitBusy(form, true)) return false;
  try {
    await api("POST", "/auth/reset", { token: state.resetToken || "", password: pw });
    state.resetToken = "";
    app.innerHTML = `
    <section class="panel center" style="max-width:460px;margin:30px auto">
      <h2>Your password is set</h2>
      <p>Sign in with your new password to pick up right where you left off.</p>
      <div class="cta-row" style="justify-content:center"><a class="btn" href="#" onclick="return go('signin')">Sign in</a></div>
    </section>`;
  } catch (err) {
    submitBusy(form, false);
    errBox(err.message);
  }
  return false;
}

async function signOut() {
  try { await api("POST", "/auth/logout", {}); } catch (e) { /* ignore */ }
  state.user = null;
  state.view = "home";
  render();
}

// Account basics (UX audit fix, 2026-10-22): every signed-in
// account surface shows who you are signed in as and offers a
// password change (current password required; every other device
// signs out, this one stays). Before this there was no settings
// surface at all: no email display, no password change, and a
// forgotten password was a permanent lockout.
function accountHtml(u) {
  return `
  <div class="panel mt">
    <h3>Your account</h3>
    <p class="small muted">Signed in as <strong>${esc(u.email)}</strong>. This is the email SIGNL uses for your account and launch messages.</p>
    <div id="acct-error"></div>
    <form onsubmit="return doChangePassword(event)">
      <div class="form-2col">
        <div class="field"><label>Current password</label><input type="password" id="acct-current" required autocomplete="current-password"></div>
        <div class="field"><label>New password (10+ characters)</label><input type="password" id="acct-new" required minlength="10" autocomplete="new-password"></div>
      </div>
      <button class="btn" type="submit">Change password</button> <span id="acct-ok" class="saved"></span>
      <p class="small muted mt">Changing your password signs out every other device on this account. This device stays signed in.</p>
    </form>
    <p class="small muted">Cannot get in at all? Sign out, then use Forgot password on the sign-in screen and we will email you a reset link.</p>
  </div>`;
}

async function doChangePassword(e) {
  e.preventDefault();
  const form = e.target;
  if (!submitBusy(form, true)) return false;
  const errEl = document.getElementById("acct-error");
  try {
    await api("POST", "/auth/change-password", {
      currentPassword: document.getElementById("acct-current").value,
      newPassword: document.getElementById("acct-new").value,
    });
    submitBusy(form, false);
    form.reset();
    if (errEl) errEl.innerHTML = "";
    const ok = document.getElementById("acct-ok");
    if (ok) ok.textContent = "Password changed.";
  } catch (err) {
    submitBusy(form, false);
    if (errEl) errEl.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

function suggestedTierId(followers) {
  const n = Number(followers) || 0;
  if (n >= 15000) return "Headliners";
  if (n >= 2000) return "Locals";
  return "Neighbors";
}

const JC_STACK_ROWS = [["jc-stack-tiktok", "tiktok"], ["jc-stack-facebook", "facebook"], ["jc-stack-x", "x"], ["jc-stack-linkedin", "linkedin"], ["jc-stack-youtube", "youtube"], ["jc-stack-snapchat", "snapchat"]];
function jcPrimary() {
  const sel = document.getElementById("jc-platform");
  return sel ? sel.value : "instagram";
}
function signupStackTotal() {
  // The main followers field IS the primary platform's count; a
  // stack row for that same platform would double it, so its row
  // is hidden by syncJcPlatform and skipped here.
  let total = parseInt((document.getElementById("jc-followers") || {}).value, 10) || 0;
  const primary = jcPrimary();
  for (const [id, platform] of JC_STACK_ROWS) {
    if (platform === primary) continue;
    const el = document.getElementById(id);
    if (el) total += parseInt(el.value, 10) || 0;
  }
  return total;
}
function syncJcPlatform() {
  syncProofDisclosure("jc-platform", "jc-proof-note");
  const meta = primaryMetaClient(jcPrimary());
  const handleLabel = document.getElementById("jc-handle-label");
  if (handleLabel) handleLabel.textContent = `${meta.label} handle (required)`;
  const followersLabel = document.getElementById("jc-followers-label");
  if (followersLabel) followersLabel.textContent = `${meta.label} followers (required)`;
  const input = document.getElementById("jc-handle");
  const link = document.getElementById("jc-ig-link");
  if (link) link.textContent = input && input.value ? meta.host + input.value.replace(/^@/, "") : "";
  for (const [, platform] of JC_STACK_ROWS) {
    const row = document.getElementById("jc-stackrow-" + platform);
    if (row) row.style.display = platform === meta.id ? "none" : "";
  }
  syncSuggestedTier();
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
  const ids = ["p-followers", "p-stack-tiktok", "p-stack-facebook", "p-stack-x", "p-stack-linkedin", "p-stack-youtube", "p-stack-snapchat"];
  return ids.reduce((s, id) => s + (parseInt((document.getElementById(id) || {}).value, 10) || 0), 0);
}

function syncPaidOptionProfile() {
  const wrap = document.getElementById("p-paid-wrap");
  if (wrap) wrap.style.display = suggestedTierId(profileStackTotal()) === "Headliners" ? "" : "none";
}

// ---------- two-step claim, step one (Jeff, 2026-10-20) ----------
// The quick claim: handle, market, email, password, and the same
// four rule checkboxes the full form carries. Submitting claims
// the founding spot (spots are held in sign-up order) and puts the
// application in the review queue; the full profile is step two,
// finished after approval from the dashboard checklist. Claim-link
// prefill (?handle=&market=) fills this form exactly like the full
// one, so every link already in the wild lands here.
function filterQuickMarketOptions() {
  const input = document.getElementById("qc-market-search");
  const sel = document.getElementById("qc-market");
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
    syncQuickMarketChoice();
  }
}

function syncQuickMarketChoice() {
  const m = document.getElementById("qc-market");
  if (!m) return;
  const unlisted = m.value === unlistedLabel();
  const customWrap = document.getElementById("qc-custom-wrap");
  if (customWrap) customWrap.style.display = unlisted ? "" : "none";
}

function syncQcPlatform() {
  const sel = document.getElementById("qc-platform");
  syncProofDisclosure("qc-platform", "qc-proof-note");
  const meta = primaryMetaClient(sel ? sel.value : "instagram");
  const label = document.getElementById("qc-handle-label");
  if (label) label.textContent = `Your ${meta.label} handle (required)`;
  const input = document.getElementById("qc-handle");
  const link = document.getElementById("qc-ig-link");
  if (link) link.textContent = input && input.value ? meta.host + input.value.replace(/^@/, "") : "";
}

function renderQuickClaim() {
  const pf = state.prefill || {};
  const pfMarket = pf.market || "Virginia Beach";
  const pfPlatform = pf.platform || "instagram";
  const hasPrefill = !!(pf.handle || pf.market || pf.tier);
  app.innerHTML = `
  <section class="panel form-panel" style="max-width:680px;margin:10px auto">
    <div class="form-head">
    <h2>Claim your founding spot</h2>
    <p><strong>${CREATOR_FREE_LINE}</strong></p>
    </div>
    <div class="form-mint">Ranked by local reach, not followers — the share of your audience that lives here.</div>
    <div class="form-body">
    <p class="muted">About a minute: handle, market, email, password. Spots held in sign-up order — finish your profile after approval.</p>
    <div class="lrow"><span class="tg"></span><div><span class="lname">Comped</span> <span class="lline">— meals, services and experiences, for an honest post within 48 hours.</span></div></div>
    <div class="lrow"><span class="tg off"></span><div><span class="lname">Paid</span> <span class="lline">— cash campaigns on top. Headliners first in line.</span></div></div>
    ${hasPrefill ? `<div class="notice blue">Pre-filled from your invite link — check it and claim.</div>` : ""}
    <div id="form-error"></div>
    <form onsubmit="return doQuickClaim(event)">
      <div class="fgroup tint">
        <p class="fg-kicker">Your platform</p>
        <div class="field"><label>Where is your main audience?</label>${platformChipsHtml("qc-platform", pfPlatform, "syncQcPlatform")}<p class="small muted">Your main platform. Add the rest later.</p><p class="small muted" id="qc-proof-note" style="display:${pfPlatform !== "instagram" ? "" : "none"}">${PROOF_DISCLOSURE}</p></div>
        <div class="field"><label id="qc-handle-label">Your ${esc(primaryLabelClient(pfPlatform))} handle (required)</label><input id="qc-handle" placeholder="yourhandle" required value="${esc(pf.handle || "")}" oninput="syncQcPlatform()"><p class="small muted" id="qc-ig-link">${pf.handle ? esc(primaryMetaClient(pfPlatform).host + pf.handle) : ""}</p><p class="small muted">Paste your handle or a link to your page, so businesses and our team can view your page.</p></div>
      </div>
      <div class="fgroup">
        <p class="fg-kicker">Your market</p>
        <div class="field"><label>Your market</label><input id="qc-market-search" placeholder="Search markets, for example: Dubai" oninput="filterQuickMarketOptions()" style="margin-bottom:6px"><select id="qc-market" onchange="syncQuickMarketChoice()">${marketOptions(pfMarket, true)}</select><p class="small muted">Grouped by country. City missing? Pick "My city is not listed yet".</p></div>
        <div id="qc-custom-wrap" style="display:none">
          <div class="field"><label>Your city</label><input id="qc-city-text" placeholder="For example: Tulsa"></div>
          <div class="field"><label>Your country</label><input id="qc-country-text" placeholder="For example: United States"></div>
          <div class="field"><label>Your state or province (optional)</label><input id="qc-state-text" placeholder="Optional, for example: OK"></div>
          <p class="small muted">Not open there yet — your sign-up counts toward opening it. Founding sign-ups go first.</p>
        </div>
      </div>
      <div class="fgroup tint">
        <p class="fg-kicker">Your account</p>
        <div class="form-2col">
          <div class="field"><label>Email (how we reach you at launch)</label><input type="email" id="qc-email" required autocomplete="email"></div>
          <div class="field"><label>Password (10+ characters)</label><input type="password" id="qc-password" required minlength="10" autocomplete="new-password"></div>
        </div>
      </div>
      <details class="deal-details"><summary>The deal, in plain words</summary>
        <div class="dd-body"><ul style="margin:8px 0 0;padding-left:18px">
          <li>A business comps you. You post honestly within 48 hours and disclose the comp. Nobody can require a positive post.</li>
          <li>Check off by pasting your post link in My Visits.</li>
          <li>Post within 48 hours for full credit. Late inside the catch-up window still counts.</li>
          <li>No post, no credit. Repeated misses can pause your account.</li>
        </ul></div>
      </details>
      <div class="field"><label class="ckrow"><input type="checkbox" class="ckbox" id="qc-agree-honest" required><span>No business can require me to post positively. My posts stay my honest opinion.</span></label></div>
      <div class="field"><label class="ckrow"><input type="checkbox" class="ckbox" id="qc-agree-ftc" required><span>I disclose every comp, as the FTC requires.</span></label></div>
      <div class="field"><label class="ckrow"><input type="checkbox" class="ckbox" id="qc-agree-compliance" required><span>I post within 48 hours of each comped visit and paste the link in the app. A post that never lands doesn't count; repeated misses can pause my account.</span></label></div>
      <div class="field"><label class="ckrow"><input type="checkbox" class="ckbox" id="qc-agree-terms" required><span>I agree to the <a href="https://joinsignl.com/terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="https://joinsignl.com/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>, and to account and launch emails. I can unsubscribe from marketing anytime.</span></label></div>
      <button class="btn" type="submit" style="width:100%">Claim my founding spot</button>
      <p class="small muted mt">Reviewed by a person — decision or clear status within 2 business days.</p>
      <p class="small">Prefer to complete everything now? <a href="#" onclick="return showFullJoin()">Build your full profile instead</a>.</p>
    </form>
    </div>
  </section>`;
  if (pf.market === unlistedLabel()) syncQuickMarketChoice();
}

async function doQuickClaim(e) {
  e.preventDefault();
  const errBox = (msg) => {
    document.getElementById("form-error").innerHTML = `<div class="error-box">${esc(msg)}</div>`;
    window.scrollTo(0, 0);
  };
  if (!document.getElementById("qc-agree-honest").checked) { errBox("Please confirm the honest-post rule."); return false; }
  if (!document.getElementById("qc-agree-ftc").checked) { errBox("Please confirm the FTC disclosure agreement."); return false; }
  if (!document.getElementById("qc-agree-compliance").checked) { errBox("Please confirm the post rule: post within 48 hours for full credit, paste the link, and understand a post that never lands means the visit does not count, and repeated misses can pause your account."); return false; }
  if (!document.getElementById("qc-agree-terms").checked) { errBox("Please agree to the Terms of Service and email consent so we can reach you at launch."); return false; }
  // The primary social link is required (Jeff, 2026-10-26): it is
  // how businesses and our team view and verify the creator's
  // page. A pasted profile link normalizes to the clean handle.
  const qcHandleInput = document.getElementById("qc-handle");
  const qcHandle = normalizeHandleClient(qcHandleInput.value);
  if (!qcHandle) { errBox(`Your ${primaryLabelClient(document.getElementById("qc-platform").value)} handle is required: paste your handle or a link to your page.`); return false; }
  qcHandleInput.value = qcHandle;
  const marketVal = document.getElementById("qc-market").value;
  const isUnlisted = marketVal === unlistedLabel();
  const customCity = isUnlisted ? document.getElementById("qc-city-text").value.trim() : "";
  const customCountry = isUnlisted ? document.getElementById("qc-country-text").value.trim() : "";
  const customState = isUnlisted ? document.getElementById("qc-state-text").value.trim() : "";
  if (isUnlisted && !customCity) { errBox("Tell us your city, so your sign-up counts toward opening SIGNL there."); return false; }
  if (isUnlisted && !customCountry) { errBox("Tell us your country, so your sign-up counts toward opening SIGNL there."); return false; }
  const form = e.target;
  if (!submitBusy(form, true)) return false;
  try {
    const data = await api("POST", "/auth/register", {
      role: "creator",
      quickClaim: true,
      email: document.getElementById("qc-email").value,
      password: document.getElementById("qc-password").value,
      market: marketVal,
      customCity: isUnlisted ? customCity : undefined,
      customCountry: isUnlisted ? customCountry : undefined,
      customState: isUnlisted ? customState : undefined,
      handle: qcHandle,
      primaryPlatform: document.getElementById("qc-platform").value,
      agreedHonestPosts: true,
      agreedFtcDisclosure: true,
      agreedPostCompliance: true,
      agreedTerms: true,
      referredBy: storedRef() || undefined,
      signupSource: storedSrc() || undefined,
    });
    state.user = data.user;
    state.view = "dashboard";
    render();
  } catch (err) {
    submitBusy(form, false);
    errBox(err.message);
  }
  return false;
}

function showFullJoin() { state.joinMode = "full"; render(); return false; }
function showQuickJoin() { state.joinMode = "quick"; render(); return false; }

function renderJoinCreator() {
  // Two-step claim (Jeff, 2026-10-20): the quick claim is the
  // default first step (handle, market, email, password, the rule
  // checkboxes); the full founding profile form below stays one
  // tap away for creators who would rather do it all now.
  if (state.joinMode !== "full") return renderQuickClaim();
  const cats = state.boot.creatorCategories.map((c) => `<label><input type="checkbox" name="c-cat" value="${esc(c)}"> ${esc(c)}</label>`).join("");
  const comps = state.boot.compCategories.map((c) => `<label><input type="checkbox" name="c-comp" value="${esc(c)}"> ${esc(c)}</label>`).join("");
  const pf = state.prefill || {};
  const pfMarket = pf.market || "Virginia Beach";
  const hasPrefill = !!(pf.handle || pf.market || pf.tier);
  app.innerHTML = `
  <section class="panel form-panel" style="max-width:680px;margin:10px auto">
    <div class="form-head">
    <h2>Become a Founding Creator</h2>
    <p><strong>${CREATOR_FREE_LINE}</strong></p>
    </div>
    <div class="form-mint">Ranked by local reach, not followers — the share of your audience that lives here.</div>
    <div class="form-body">
    <p class="muted">Build your full profile now. When your market opens (30–90 days), founding creators get priority. This is your real profile, not a waitlist.</p>
    <p class="small muted">City missing? Pick "My city is not listed yet" and sign up anyway.</p>
    <div class="lrow"><span class="tg"></span><div><span class="lname">Comped</span> <span class="lline">— meals, services and experiences, for an honest post within 48 hours.</span></div></div>
    <div class="lrow"><span class="tg off"></span><div><span class="lname">Paid</span> <span class="lline">— cash campaigns on top. Headliners first in line.</span></div></div>
    ${hasPrefill ? `<div class="notice blue">Pre-filled from your invite link — check it and finish.</div>` : ""}
    <p class="small">In a hurry? <a href="#" onclick="return showQuickJoin()">Claim your spot with just your handle</a> and finish your profile after approval instead.</p>
    <div id="form-error"></div>
    <form onsubmit="return doRegisterCreator(event)">
      <div class="fgroup tint">
        <p class="fg-kicker">About you</p>
        <div class="form-2col">
          <div class="field"><label>Full name</label><input id="jc-name" required autocomplete="name"></div>
          <div class="field"><label>Email (how we reach you at launch)</label><input type="email" id="jc-email" required autocomplete="email"></div>
        </div>
        <div class="field"><label>Password (10+ characters)</label><input type="password" id="jc-password" required minlength="10" autocomplete="new-password"></div>
      </div>
      <div class="fgroup">
        <p class="fg-kicker">Where you are</p>
        <div class="form-2col">
          <div class="field"><label>Your market</label><input id="jc-market-search" placeholder="Search markets, for example: Dubai" oninput="filterMarketOptions()" style="margin-bottom:6px"><select id="jc-market" onchange="syncMarketChoice()">${marketOptions(pfMarket, true)}</select><p class="small muted">Grouped by country. City missing? Pick "My city is not listed yet".</p></div>
          <div class="field" id="jc-city-wrap"><label>Your home city</label><select id="jc-city">${cityOptions(pfMarket)}</select></div>
          <div id="jc-custom-wrap" style="display:none">
            <div class="field"><label>Your city</label><input id="jc-city-text" placeholder="For example: Tulsa"></div>
            <div class="field"><label>Your country</label><input id="jc-country-text" placeholder="For example: United States"></div>
            <div class="field"><label>Your state or province (optional)</label><input id="jc-state-text" placeholder="Optional, for example: OK"></div>
            <p class="small muted">Not open there yet — your sign-up counts toward opening it. Founding sign-ups go first.</p>
          </div>
        </div>
        <div class="field"><label>Your neighborhood or area (optional)</label><input id="jc-neighborhood" placeholder="For example: Oceanfront, Ghent, Town Center" maxlength="80"><p class="small muted">Businesses search by neighborhood.</p></div>
        <div class="field"><label>What do you do? (optional)</label>${professionChipsHtml("jc-profession", "")}<p class="small muted">Realtors: pick Real estate agent for neighborhood tags + a listing proof sheet.</p></div>
        <div class="field"><label>Your university (if you are a student now)</label><input id="jc-university" placeholder="Start typing your school" maxlength="120"><div class="uni-results" id="jc-university-results"></div><p class="small muted">Current students get a campus badge. Pick from the list, or type it in full.</p></div>
        <div class="field"><label>Student status (optional)</label>${universityStatusChipsHtml("jc-university-status", "")}<p class="small muted">Badge is current students only.</p></div>
      </div>
      <div class="fgroup tint">
        <p class="fg-kicker">Your audience</p>
        <div class="field"><label>Where is your main audience?</label>${platformChipsHtml("jc-platform", pf.platform || "instagram", "syncJcPlatform")}<p class="small muted">Your main platform. The rest stack on top.</p><p class="small muted" id="jc-proof-note" style="display:${(pf.platform || "instagram") !== "instagram" ? "" : "none"}">${PROOF_DISCLOSURE}</p></div>
      <div class="form-2col">
        <div class="field"><label id="jc-handle-label">${esc(primaryLabelClient(pf.platform || "instagram"))} handle (required)</label><input id="jc-handle" placeholder="yourhandle" required value="${esc(pf.handle || "")}" oninput="syncJcPlatform()"><p class="small muted" id="jc-ig-link"></p><p class="small muted">Paste your handle or a link to your page, so businesses and our team can view your page.</p></div>
        <div class="field"><label>TikTok handle (optional)</label><input id="jc-tiktok" placeholder="yourhandle"></div>
      </div>
      <div class="field"><label>YouTube channel (optional)</label><input id="jc-youtube" placeholder="Channel name or URL"></div>
      <div class="form-2col">
        <div class="field"><label>Facebook profile or Page (optional)</label><input id="jc-facebook" placeholder="facebook.com/yourpage or full URL"></div>
        <div class="field"><label>X (Twitter) handle or URL (optional)</label><input id="jc-x" placeholder="yourhandle or x.com/yourhandle"></div>
      </div>
      <div class="field"><label>LinkedIn profile (optional)</label><input id="jc-linkedin" placeholder="linkedin.com/in/yourname or full URL"></div>
      <div class="form-2col">
        <div class="field"><label id="jc-followers-label">${esc(primaryLabelClient(pf.platform || "instagram"))} followers (required)</label><input type="number" id="jc-followers" min="0" required placeholder="For example 8400" oninput="syncSuggestedTier()"></div>
        <div class="field"><label>Your tier band</label><p id="jc-tier-line" style="margin:6px 0">Your band is set automatically from your total audience across platforms.</p><p class="small muted">Neighbors 500–2k &middot; Locals 2k–15k &middot; Headliners 15k+. Set automatically.</p></div>
      </div>
      <div class="field"><label>Your audience on other platforms (optional)</label>
        <div class="form-2col">
          <div class="field" id="jc-stackrow-tiktok"><label>TikTok followers</label><input type="number" id="jc-stack-tiktok" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
          <div class="field" id="jc-stackrow-facebook"><label>Facebook followers</label><input type="number" id="jc-stack-facebook" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
          <div class="field" id="jc-stackrow-x"><label>X followers</label><input type="number" id="jc-stack-x" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
          <div class="field" id="jc-stackrow-linkedin"><label>LinkedIn connections</label><input type="number" id="jc-stack-linkedin" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
          <div class="field" id="jc-stackrow-youtube"><label>YouTube subscribers</label><input type="number" id="jc-stack-youtube" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
          <div class="field" id="jc-stackrow-snapchat"><label>Snapchat followers</label><input type="number" id="jc-stack-snapchat" min="0" placeholder="Optional" oninput="syncSuggestedTier()"></div>
        </div>
        <p class="small muted">Your tier reads your TOTAL across platforms. Add the ones you use.</p>
      </div>
      <div class="form-2col">
        <div class="field"><label>Typical post views (optional)</label><input type="number" id="jc-avgviews" min="0" placeholder="For example 6000"></div>
        <div class="field"><label>Your local reach: what share of your followers live in your market? (%)</label>
          <input type="number" id="jc-localpct" min="0" max="100" required placeholder="For example 60">
          <p class="small muted">${LOCAL_PCT_HELP}</p>
        </div>
      </div>
        <div class="field"><label>Top audience cities (optional)</label><input id="jc-topcities" placeholder="For example: Virginia Beach, Norfolk, Chesapeake"><p class="small muted">Up to 5, comma separated.</p></div>
      </div>
      <div class="fgroup">
        <p class="fg-kicker">What you create</p>
        <div class="field"><label>What do you create in? (pick at least one)</label><div class="checkrow">${cats}</div></div>
        <div class="field"><label>Comps you would accept (optional)</label><div class="checkrow">${comps}</div></div>
        <div class="field" id="jc-paid-wrap" style="display:none">
          <label class="tgl-row"><input type="checkbox" class="sw" id="jc-paid"><span><strong>Paid cash campaigns</strong> (Headliners tier): on top of comps, businesses can hire me for paid campaigns when a business runs one.</span></label>
          <p class="small muted">Paid campaigns depend on the business and the campaign. Comps are always part of SIGNL; cash work is extra when it is offered.</p>
        </div>
        <div class="field"><label>Short bio</label><textarea id="jc-bio" rows="2" placeholder="What do you post, where do you go, what do you love locally?"></textarea></div>
        <div class="field"><label>Profile photo (optional, add now or later)</label><input type="file" id="jc-photo" accept="image/png,image/jpeg,image/webp"><p class="small muted">PNG, JPEG, or WebP, under 2.5 MB. Businesses see this on your profile when your market opens.</p></div>
      </div>
      <div class="notice blue">The deal, in plain words:
        <ul style="margin:8px 0 0;padding-left:18px">
          <li>A business comps you a meal or service. You post your honest experience within 48 hours of the visit and disclose the comp. Nobody can ask you for a positive post. Ever.</li>
          <li>Your check-off is the post link: you paste it in the app under My Visits. The link is the proof.</li>
          <li>Post within 48 hours of the visit for full credit. A late post inside the catch-up window still counts.</li>
          <li>If a post never lands, the visit does not count, and repeated misses can pause your account. Showing up matters here.</li>
        </ul>
      </div>
      <div class="field"><label class="ckrow"><input type="checkbox" class="ckbox" id="jc-agree-honest" required><span>I understand no business can require me to post positively. My posts stay my honest opinion.</span></label></div>
      <div class="field"><label class="ckrow"><input type="checkbox" class="ckbox" id="jc-agree-ftc" required><span>I agree to clearly disclose every comp in my posts, as the FTC requires.</span></label></div>
      <div class="field"><label class="ckrow"><input type="checkbox" class="ckbox" id="jc-agree-compliance" required><span>I agree to post within 48 hours of every comped visit for full credit and paste the post link in the app. I understand a post that never lands means the visit does not count, and repeated misses can pause my account.</span></label></div>
      <div class="field"><label class="ckrow"><input type="checkbox" class="ckbox" id="jc-agree-terms" required><span>I agree to the <a href="https://joinsignl.com/terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="https://joinsignl.com/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>, and I agree SIGNL can email me about my account, launch updates and offers. I can unsubscribe from marketing emails at any time.</span></label></div>
      <div id="jc-save-warn"></div>
      <button class="btn" type="submit" style="width:100%">Create my profile</button>
      <p class="small muted mt">Every application is reviewed by a person, and every founding application gets a decision or a clear status within 2 business days. Founding spots are held in sign-up order.</p>
    </form>
    </div>
  </section>`;
  // Claim-link prefill, applied to the live form: the handle link
  // preview and the unlisted-city swap when the link named no listed
  // market. (The ?tier= param is still parsed, but bands are fully
  // automatic now, so it fills nothing.) Filling only; nothing here
  // submits anything.
  syncJcPlatform();
  if (pf.market === unlistedLabel()) syncMarketChoice();
  setupUniversityAutocomplete("jc-university", "jc-university-results");
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

// ---------- photo gallery (profile edit) ----------
// Up to 6 photos, first = cover. Each change saves on its own
// through the photo endpoints (same discipline as the lane
// control): the profile form save never touches photos, so it
// cannot clobber the gallery either.
function galleryCountOf(c) {
  const n = c && c.photoCount;
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 6) : (c && c.hasPhoto ? 1 : 0);
}
function galleryUrlsOf(u) {
  const n = galleryCountOf(u.creator || {});
  const out = [];
  for (let i = 0; i < n; i++) out.push(i === 0 ? `/api/users/${u.id}/photo` : `/api/users/${u.id}/photo/${i}`);
  return out;
}
function galleryHtml(u) {
  const urls = galleryUrlsOf(u);
  const v = state.galleryV || 0;
  const tiles = urls.map((src, i) => `
    <div class="gal-tile">
      <img src="${esc(src)}?v=${v}" alt="Your photo ${i + 1}">
      ${i === 0 ? `<span class="gal-cover">Cover</span>` : `<button type="button" class="gal-btn" onclick="return galleryMakeCover(${i})">Make cover</button>`}
      <button type="button" class="gal-btn gal-del" onclick="return galleryRemovePhoto(${i})">Remove</button>
    </div>`).join("");
  const add = urls.length < 6 ? `<label class="gal-tile gal-add"><input type="file" accept="image/png,image/jpeg,image/webp" onchange="galleryAddPhoto(this)"><span>Add photo</span></label>` : "";
  return `<div class="gal-grid">${tiles}${add}</div>`;
}
async function galleryOp(run) {
  const err = document.getElementById("gallery-err");
  if (err) err.style.display = "none";
  try {
    const data = await run();
    if (data && state.user && state.user.creator) {
      state.user.creator.photoCount = data.photoCount;
      state.user.creator.hasPhoto = data.photoCount > 0;
    }
    state.galleryV = (state.galleryV || 0) + 1;
    const host = document.getElementById("p-gallery");
    if (host && state.user) host.innerHTML = galleryHtml(state.user);
    return true;
  } catch (e) {
    if (err) { err.textContent = (e && e.message) || "That photo change did not save."; err.style.display = "block"; }
    return false;
  }
}
function galleryAddPhoto(input) {
  const file = input && input.files && input.files[0];
  if (!file) return false;
  const reader = new FileReader();
  reader.onload = () => {
    const slot = galleryCountOf(state.user.creator || {});
    galleryOp(() => api("POST", "/me/photo", { dataUrl: reader.result, slot }));
  };
  reader.onerror = () => {
    const err = document.getElementById("gallery-err");
    if (err) { err.textContent = "That photo could not be read."; err.style.display = "block"; }
  };
  reader.readAsDataURL(file);
  return false;
}
function galleryMakeCover(i) {
  galleryOp(() => api("POST", "/me/photo/cover", { slot: i }));
  return false;
}
function galleryRemovePhoto(i) {
  galleryOp(() => api("DELETE", `/me/photo/${i}`));
  return false;
}

// Public surfaces: the cover stays the hero; the rest of the
// gallery rides under it as a snap-scroll row (shown when the
// gallery has anything beyond the cover).
function galleryRowHtml(photos) {
  const list = Array.isArray(photos) ? photos.filter(Boolean) : [];
  if (list.length < 2) return "";
  return `<div class="gal-row">${list.slice(1).map((src) => `<img class="gal-row-img" src="${esc(src)}" alt="" loading="lazy">`).join("")}</div>`;
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
  if (!document.getElementById("jc-agree-compliance").checked) { errBox("Please confirm the post rule: post within 48 hours for full credit, paste the link, and understand a post that never lands means the visit does not count, and repeated misses can pause your account."); return false; }
  const primaryPlatform = jcPrimary();
  const stackFromForm = {};
  const primaryCount = parseInt(document.getElementById("jc-followers").value, 10) || 0;
  if (primaryCount > 0) stackFromForm[primaryPlatform] = primaryCount;
  for (const [id, platform] of JC_STACK_ROWS) {
    if (platform === primaryPlatform) continue;
    const v = parseInt(document.getElementById(id).value, 10) || 0;
    if (v > 0) stackFromForm[platform] = v;
  }
  if (!document.getElementById("jc-agree-terms").checked) { errBox("Please agree to the Terms of Service and email consent so we can reach you at launch."); return false; }
  // The primary social link is required (Jeff, 2026-10-26): it is
  // how businesses and our team view and verify the creator's
  // page. A pasted profile link normalizes to the clean handle.
  const jcHandleInput = document.getElementById("jc-handle");
  const jcHandle = normalizeHandleClient(jcHandleInput.value);
  if (!jcHandle) { errBox(`Your ${primaryLabelClient(primaryPlatform)} handle is required: paste your handle or a link to your page.`); return false; }
  jcHandleInput.value = jcHandle;
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
  // Zero-audience warning (audit F9 twin): an all-zero stack is a
  // valid sign-up but an unbookable profile. Say so inline before
  // it submits, and let the creator choose.
  const zeroWarnings = zeroAudienceWarnings(signupStackTotal());
  if (zeroWarnings.length) {
    const proceed = await confirmSaveWarning("jc-save-warn", "Before you sign up:", zeroWarnings, "Sign up anyway");
    if (!proceed) return false;
  }
  const form = e.target;
  if (!submitBusy(form, true)) return false;
  try {
    const data = await api("POST", "/auth/register", {
      role: "creator",
      name: document.getElementById("jc-name").value,
      email: document.getElementById("jc-email").value,
      password: document.getElementById("jc-password").value,
      market: marketVal,
      city: isUnlisted ? undefined : document.getElementById("jc-city").value,
      neighborhood: document.getElementById("jc-neighborhood").value,
      profession: document.getElementById("jc-profession").value || undefined,
      university: document.getElementById("jc-university").value,
      universityStatus: document.getElementById("jc-university-status").value || undefined,
      customCity: isUnlisted ? customCity : undefined,
      customCountry: isUnlisted ? customCountry : undefined,
      customState: isUnlisted ? customState : undefined,
      handle: jcHandle,
      primaryPlatform,
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
      signupSource: storedSrc() || undefined,
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
    submitBusy(form, false);
    errBox(err.message);
  }
  return false;
}

function renderForBusinesses() {
  const plans = state.boot.plans.map((p, i) => `
    <div class="plan-card ${i === 0 ? "selected" : ""}" id="plan-${esc(p.id)}" onclick="selectPlan('${esc(p.id)}')">
      <div class="price">$${fmtPrice(p.priceMonthly)}<span class="small muted">/mo</span></div>
      <div class="founding-badge-row">${foundingBadgeHtml(p)}</div>
      <strong>${esc(p.name)}</strong>
      <p class="small muted">${p.minMonths}-month minimum. Founding rate, locked while your plan stays active.</p>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </div>`).join("");
  app.innerHTML = `
  <section class="panel form-panel" style="max-width:680px;margin:10px auto">
    <div class="form-head">
    <h2>For Businesses: join the founding list</h2>
    <p>Join the founding business list. We hold your place while your market's roster is built.</p>
    <p><strong>Founding pricing</strong> — locked while you stay subscribed. Activated by hand, in application order.</p>
    </div>
    <div class="form-body">
    <div class="plan-cards">${plans}</div>
    <div class="notice blue mt">Joining is free. No card taken — payment stays concierge at activation.</div>
    <div id="jb-prefill"></div>
    <div id="jb-error"></div>
    <form onsubmit="return registerBusiness(event)">
      <div class="fgroup tint">
        <p class="fg-kicker">Your business</p>
        <div class="form-2col">
          <div class="field"><label>Your name</label><input id="jb-name" required placeholder="The person running this account"></div>
          <div class="field"><label>Business name</label><input id="jb-business" required placeholder="Your business as customers know it"></div>
        </div>
        <div class="form-2col">
          <div class="field"><label>Email</label><input id="jb-email" type="email" required placeholder="you@yourbusiness.com"></div>
          <div class="field"><label>Password (10+ characters)</label><input id="jb-password" type="password" required minlength="10"></div>
        </div>
      </div>
      <div class="fgroup">
        <p class="fg-kicker">Where + what</p>
        <div class="field"><label>Category</label>${chipSelectHtml("jb-category", state.boot.businessCategories.map((c) => ({ value: c, label: c })), state.boot.businessCategories[0], null, false)}</div>
        <div class="field"><label>Market</label><input id="jb-market-search" placeholder="Search markets" oninput="filterBizMarketOptions()" style="margin-bottom:6px"><select id="jb-market" onchange="syncBizMarketChoice()">${marketOptions("", true)}</select><p class="small muted">City missing? Pick "My city is not listed yet".</p></div>
      <div id="jb-custom-wrap" style="display:none">
        <div class="notice blue">Your sign-up counts toward opening SIGNL in your city. Founding pricing held — we email you at launch.</div>
        <div class="form-2col">
          <div class="field"><label>Your city</label><input id="jb-city-text" placeholder="For example: Tulsa"></div>
          <div class="field"><label>Your country</label><input id="jb-country-text" placeholder="For example: United States"></div>
        </div>
        <div class="field"><label>Your state or province (optional)</label><input id="jb-state-text" placeholder="Optional, for example: OK"></div>
      </div>
      <div class="form-2col" id="jb-city-row">
        <div class="field"><label>City</label><select id="jb-city"></select></div>
        <div class="field"><label>Neighborhood / area (optional)</label><input id="jb-neighborhood" placeholder="For example: Oceanfront, Ghent"></div>
      </div>
        <div class="field"><label>About your business (optional)</label><textarea id="jb-about" rows="3" placeholder="What you serve, what the visit feels like, anything SIGNL should know when reviewing your application"></textarea></div>
      </div>
      <input type="hidden" id="jb-plan" value="${esc(state.boot.plans[0].id)}">
      <div class="field"><label class="ckrow"><input type="checkbox" class="ckbox" id="jb-terms" required><span>I agree to the Terms of Service and Privacy Policy, and to account and marketing emails from SIGNL.</span></label></div>
      <button class="btn mt" type="submit" style="width:100%">Join founding list</button>
    </form>
    <p class="small muted mt">Reviewed by a person — decision within 2 business days. The roster stays private until activation. Creators join separately: <a href="#" onclick="return go('join-creator')">become a founding creator</a>.</p>
    </div>
  </section>`;
  bizCityOptions();
  applyBizPrefill();
}

// Business-wave prefill application (Jeff, 2026-10-23): when
// the visitor arrived on a prebuilt link, the founding
// registration opens with the business name, market and
// category already filled in, under a note that says so. Every
// field stays editable, per the form's existing conventions;
// the business still adds its own name, email and password.
function applyBizPrefill() {
  const pre = state.bizPrefill;
  if (!pre) return;
  const note = document.getElementById("jb-prefill");
  if (note && pre.businessName) {
    note.innerHTML = `<div class="notice blue">We pre-built this founding registration for ${esc(pre.businessName)}. Check the details, add your name, email and password, and claim your spot.</div>`;
  }
  const bizEl = document.getElementById("jb-business");
  if (bizEl && pre.businessName) bizEl.value = pre.businessName;
  const catEl = document.getElementById("jb-category");
  if (catEl && pre.category) {
    catEl.value = pre.category;
    // V4: the category is a chip group over this hidden input —
    // keep the highlighted chip in step with the prefilled value.
    const catRow = document.querySelector('.chiprow[data-chipfor="jb-category"]');
    if (catRow) catRow.querySelectorAll(".rchip").forEach((b) => b.classList.toggle("on", (b.getAttribute("data-val") || "") === pre.category));
  }
  const mktEl = document.getElementById("jb-market");
  if (mktEl && pre.market) {
    mktEl.value = pre.market;
    syncBizMarketChoice();
  }
}

function bizCityOptions() {
  const mkt = state.boot.markets.find((m) => m.name === document.getElementById("jb-market").value);
  const sel = document.getElementById("jb-city");
  if (!sel) return;
  sel.innerHTML = (mkt ? mkt.cities : []).map((c) => `<option>${esc(c)}</option>`).join("");
}

// The business market picker gets the same search + not-listed
// treatment the creator forms have (UX audit fix, 2026-10-22):
// search filters the grouped options, and "My city is not listed
// yet" swaps the city dropdown for the founding-list interest
// fields instead of dead-ending the registration.
function filterBizMarketOptions() {
  const input = document.getElementById("jb-market-search");
  const sel = document.getElementById("jb-market");
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
    syncBizMarketChoice();
  }
}

function syncBizMarketChoice() {
  const m = document.getElementById("jb-market");
  if (!m) return;
  const unlisted = m.value === unlistedLabel();
  const customWrap = document.getElementById("jb-custom-wrap");
  const cityRow = document.getElementById("jb-city-row");
  if (customWrap) customWrap.style.display = unlisted ? "" : "none";
  if (cityRow) cityRow.style.display = unlisted ? "none" : "";
  if (!unlisted) bizCityOptions();
}

async function registerBusiness(e) {
  e.preventDefault();
  const form = e.target;
  const errBox = (msg) => { document.getElementById("jb-error").innerHTML = `<div class="error-box">${esc(msg)}</div>`; };
  const marketVal = document.getElementById("jb-market").value;
  const isUnlisted = marketVal === unlistedLabel();
  const customCity = isUnlisted ? document.getElementById("jb-city-text").value.trim() : "";
  const customCountry = isUnlisted ? document.getElementById("jb-country-text").value.trim() : "";
  const customState = isUnlisted ? document.getElementById("jb-state-text").value.trim() : "";
  if (isUnlisted && !customCity) { errBox("Tell us your city, so your sign-up counts toward opening SIGNL there."); return false; }
  if (isUnlisted && !customCountry) { errBox("Tell us your country, so your sign-up counts toward opening SIGNL there."); return false; }
  if (!submitBusy(form, true)) return false;
  try {
    const data = await api("POST", "/auth/register", {
      role: "business",
      name: document.getElementById("jb-name").value,
      businessName: document.getElementById("jb-business").value,
      email: document.getElementById("jb-email").value,
      password: document.getElementById("jb-password").value,
      market: marketVal,
      customCity: isUnlisted ? customCity : undefined,
      customCountry: isUnlisted ? customCountry : undefined,
      customState: isUnlisted ? customState : undefined,
      city: isUnlisted ? undefined : document.getElementById("jb-city").value,
      category: document.getElementById("jb-category").value,
      neighborhood: document.getElementById("jb-neighborhood").value,
      about: document.getElementById("jb-about").value,
      planId: document.getElementById("jb-plan").value,
      agreedTerms: document.getElementById("jb-terms").checked,
      signupSource: storedSrc() || undefined,
    });
    state.user = data.user;
    state.view = "dashboard";
    state.tab = null;
    render();
  } catch (err) {
    submitBusy(form, false);
    errBox(err.message);
  }
  return false;
}

// Founding price hierarchy (Jeff, 2026-10-26): wherever a
// business sees a plan price, the standard rate is the hero
// figure and the founding first-month price rides directly
// under it as a bold mint badge, never the other way around.
// The small print under the card carries the 3-month minimum
// and the founding-rate-held line only: the first-month price
// is stated once, in the badge.
function foundingBadgeHtml(p) {
  return `<span class="founding-badge">FOUNDING: FIRST MONTH $${fmtPrice(p.firstMonthPriceMonthly)}</span>`;
}

function selectPlan(id) {
  document.getElementById("jb-plan").value = id;
  document.querySelectorAll(".plan-card").forEach((el) => el.classList.remove("selected"));
  const el = document.getElementById("plan-" + id);
  if (el) el.classList.add("selected");
  const hidden = document.getElementById("me-plan");
  if (hidden) hidden.value = id;
}

// The founding business status page: the ONLY screen a business
// sees before activation (pending or approved). It mirrors the
// creator founding pattern: what they joined, their plan
// interest, the promises, and what happens next. No roster, no
// product tools, no payment link: payment stays concierge.
function renderBusinessFoundingStatus() {
  const u = state.user;
  const bz = u.business || {};
  const inReview = u.status !== "approved";
  const bizPlace = u.market === unlistedLabel() ? (u.city || "your city") : marketTalkNameClient(u.market);
  app.innerHTML = `<div class="wrap" style="max-width:680px">
  ${wsHead("Status", { sub: "Where your founding enrollment stands." })}
  <section class="wcard" style="margin-top:14px">
    <p><span class="badge ${inReview ? "info" : "ok"}">${inReview ? "Application in review" : "Founding list"}</span></p>
    <h2 style="margin-top:8px">${esc(bz.businessName || "Your business")} is on the founding list</h2>
    <p>You joined the <strong>Founding business list, ${esc(bizPlace)}</strong>. Businesses do not get product access yet: the creator roster stays hidden until SIGNL activates your business by hand.</p>
    ${marketResolvedNote(u)}
    <p>${inReview
      ? `Your application is in review. Every founding application gets a decision or a clear status within 2 business days.`
      : `Your application is approved, and your founding spot is held. Activation is a separate step, done by hand by SIGNL.`}</p>
    <div class="panel" style="margin-top:16px">
      <div class="ui-row"><span class="k">Plan interest</span><span class="v">${esc(bz.planName || "")}</span></div>
      <div class="ui-row"><span class="k">Category spot</span><span class="v">Your ${esc(bz.category || "business")} spot is held in application order</span></div>
      <div class="ui-row"><span class="k">Founding pricing</span><span class="v">Locked while you stay subscribed</span></div>
      <div class="ui-row"><span class="k">Activation</span><span class="v">When ${esc(bizPlace)} opens, or sooner if SIGNL activates your business by hand for a pilot</span></div>
      <div class="ui-row"><span class="k">Payment</span><span class="v">Nothing is due now. Payment stays concierge: Jeff sends the payment step by hand at activation</span></div>
    </div>
    <h3 class="mt">What happens next</h3>
    <ol style="padding-left:20px">
      <li>${inReview ? "SIGNL reviews your application. You will get a decision or a clear status within 2 business days." : "Your application is approved. There is nothing else you need to send right now."}</li>
      <li>SIGNL keeps building the founding creator roster in ${esc(marketTalkNameClient(u.market))}. The roster is not shown to businesses before activation.</li>
      <li>When your market opens, SIGNL activates founding businesses by hand, in application order. A pilot business can be activated sooner.</li>
      <li>The moment your business is activated, this page opens into the full app: browse, favorites, and draft offers. Publishing follows your market's launch.</li>
    </ol>
    <p class="muted small">Sign back in any time to check your status. Questions: hello@joinsignl.com</p>
    <div class="mt"><button class="btn ghost" onclick="signOut()">Sign out</button></div>
  </section>
  ${accountHtml(u)}</div>`;
}

function renderPending() {
  const u = state.user;
  if (u.role === "business") return renderBusinessFoundingStatus();
  const f = u.founding || {};
  const isCreator = u.role === "creator";
  const isUnlisted = isCreator && u.market === unlistedLabel();
  const place = isUnlisted ? esc(unlistedPlace(u)) : esc(marketTalkNameClient(u.market));
  // Two-step claim (Jeff, 2026-10-20): a quick claim is a claimed
  // spot, not a built profile, and the screen says so plainly.
  const claimedOnly = isCreator && u.creator && u.creator.signupPath === "quick_claim" && u.creator.profileComplete === false;
  app.innerHTML = `
  <section class="panel center" style="max-width:560px;margin:40px auto">
    <h2>${claimedOnly ? "Your spot is claimed" : "Founding profile received"}</h2>
    ${claimedOnly
      ? `<p>Thanks, ${esc(u.name)}. Your founding spot in <strong>${place}</strong> is claimed and your application is in the review queue. Every founding application gets a decision or a clear status within 2 business days.</p>
    <p class="muted" style="text-align:left">Your profile is not finished yet, and that is by design: when you are approved, we email you, and you finish your profile from the checklist on your dashboard (your home city, your audience counts, what share of it is local, your photo). A finished profile is what businesses see, so that step is what makes you bookable.</p>`
      : `<p>Thanks, ${esc(u.name)}. Your founding creator profile for <strong>${place}</strong> is built and in the review queue. Every founding application gets a decision or a clear status within 2 business days.</p>`}
    ${isCreator ? `<p><strong>${CREATOR_FREE_LINE}</strong></p>` : ""}
    ${isCreator ? marketResolvedNote(u) : ""}
    ${isCreator && isUnlisted && Array.isArray(u.marketCandidates) && u.marketCandidates.length ? `
    <div style="text-align:left;margin-top:16px">
      <p class="small" style="margin:0"><strong>One quick thing:</strong> ${esc(typedCityDisplay(u))} is in more than one SIGNL market. Which one is yours?</p>
      <div style="margin-top:8px">${u.marketCandidates.map((m) => `<button class="btn small-btn" style="margin:0 8px 8px 0" onclick="return pickCandidateMarket(event, '${esc(m)}')">${esc(marketDisplayName(m))}</button>`).join("")}</div>
      <p class="small muted" style="margin:0">Your typed city stays as your home city either way.</p>
    </div>` : ""}
    ${isCreator && f.queueBand ? `<p><span class="badge info">${isUnlisted ? `You are in the first ${f.queueBand} to sign up in ${esc(u.city)}` : `You are in the first ${f.queueBand} founding creators in ${esc(marketTalkNameClient(u.market))}`}</span></p>` : ""}
    <p class="muted">${isUnlisted
      ? `SIGNL is not open in ${esc(u.city)} yet, and your sign-up counts toward opening it: we open new markets where creator sign-ups pile up, and founding sign-ups there go first. Every application is reviewed by a person. The moment you are approved, your founding status page opens here, and we will email you at ${esc(u.email)} the moment ${esc(u.city)} opens. Sign back in any time to check your status.${state.boot && state.boot.email && state.boot.email.enabled ? ` A confirmation email is on its way to ${esc(u.email)}.` : ""}`
      : `Every application is reviewed by a person. The moment you are approved, your founding status page opens here, and we will email you at ${esc(u.email)} when ${esc(marketTalkNameClient(u.market))} opens to businesses in the next 30 to 90 days. Sign back in any time to check your status.${state.boot && state.boot.email && state.boot.email.enabled ? ` A confirmation email is on its way to ${esc(u.email)}.` : ""}`}</p>
    ${isCreator && !(u.creator && u.creator.hasPhoto) ? `
    <div style="text-align:left">
      <div class="field"><label>Add your profile photo now (optional)</label><input type="file" id="pending-photo" accept="image/png,image/jpeg,image/webp"></div>
      <button class="btn small-btn" onclick="return uploadPendingPhoto(event)">Upload photo</button> <span id="pending-photo-ok" class="saved"></span>
    </div>` : ""}
    ${isCreator ? `
    <div style="text-align:left;margin-top:16px">
      <p class="small" style="margin:0"><a href="#" onclick="return togglePendingMarket(event)"><strong>Wrong market?</strong></a> <span class="muted">If ${place} is not where your audience is, move your application now, while it is still in review. Once a decision lands, your market is set.</span></p>
      <div id="pm-wrap" style="display:none;margin-top:10px">
        <div id="pm-error"></div>
        <div class="field"><label>Your market</label><input id="pm-market-search" placeholder="Search markets, for example: Raleigh" oninput="filterPendingMarketOptions()" style="margin-bottom:6px"><select id="pm-market" onchange="syncPendingMarketChoice()">${marketOptions(u.market === unlistedLabel() ? "" : u.market, true)}</select></div>
        <div class="field" id="pm-city-wrap"><label>Your home city</label><select id="pm-city">${cityOptions(u.market, u.city || "")}</select></div>
        <div id="pm-custom-wrap" style="display:none">
          <div class="field"><label>Your city</label><input id="pm-city-text" value="${esc(u.city || "")}" placeholder="For example: Tulsa"></div>
          <div class="field"><label>Your country</label><input id="pm-country-text" value="${esc(u.country || "")}" placeholder="For example: United States"></div>
          <div class="field"><label>Your state or province (optional)</label><input id="pm-state-text" value="${esc(u.state || "")}" placeholder="Optional, for example: OK"></div>
          <p class="small muted">Not open there yet — your sign-up counts toward opening it. Founding sign-ups go first.</p>
        </div>
        <button class="btn small-btn" onclick="return savePendingMarket(event)">Move my application</button>
        <p class="small muted" style="margin-top:8px">Your sign-up time moves with you, so your place in line is kept.</p>
      </div>
    </div>` : ""}
    ${isCreator ? growRosterHtml(u) : ""}
    <div class="mt"><button class="btn ghost" onclick="signOut()">Sign out</button></div>
  </section>`;
  if (isCreator) initPendingMarket();
}

async function uploadPendingPhoto(e) {
  e.preventDefault();
  const ok = await uploadPhotoInput("pending-photo");
  const el = document.getElementById("pending-photo-ok");
  if (el) el.textContent = ok ? "Photo added to your profile." : "That photo did not upload. You can add it later from your profile.";
  if (ok && state.user && state.user.creator) state.user.creator.hasPhoto = true;
  return false;
}

// Wrong-market rescue (audit F2): while the application is in
// review, the market can still be fixed from the pending screen.
// The form mirrors signup (canonical market + a city inside it, or
// the typed not-listed path); the server accepts the change only
// while the application is pending, and stamps it on the record.
function togglePendingMarket(e) {
  if (e) e.preventDefault();
  const wrap = document.getElementById("pm-wrap");
  if (wrap) wrap.style.display = wrap.style.display === "none" ? "" : "none";
  return false;
}

function initPendingMarket() {
  const sel = document.getElementById("pm-market");
  if (!sel || !state.user) return;
  if (state.user.market === unlistedLabel()) sel.value = unlistedLabel();
  syncPendingMarketChoice();
}

function filterPendingMarketOptions() {
  const input = document.getElementById("pm-market-search");
  const sel = document.getElementById("pm-market");
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
    syncPendingMarketChoice();
  }
}

function syncPendingMarketChoice() {
  const m = document.getElementById("pm-market");
  if (!m) return;
  const unlisted = m.value === unlistedLabel();
  const customWrap = document.getElementById("pm-custom-wrap");
  const cityWrap = document.getElementById("pm-city-wrap");
  if (customWrap) customWrap.style.display = unlisted ? "" : "none";
  if (cityWrap) cityWrap.style.display = unlisted ? "none" : "";
  if (!unlisted) {
    const citySel = document.getElementById("pm-city");
    if (citySel) citySel.innerHTML = cityOptions(m.value, citySel.value);
  }
}

async function savePendingMarket(e) {
  if (e) e.preventDefault();
  const errBox = (msg) => {
    const el = document.getElementById("pm-error");
    if (el) el.innerHTML = `<div class="error-box">${esc(msg)}</div>`;
  };
  const marketVal = document.getElementById("pm-market").value;
  const isUnlisted = marketVal === unlistedLabel();
  const body = { market: marketVal };
  if (isUnlisted) {
    body.customCity = document.getElementById("pm-city-text").value.trim();
    body.customCountry = document.getElementById("pm-country-text").value.trim();
    body.customState = document.getElementById("pm-state-text").value.trim();
    if (!body.customCity) { errBox("Tell us your city, so your sign-up counts toward opening SIGNL there."); return false; }
    if (!body.customCountry) { errBox("Tell us your country, so your sign-up counts toward opening SIGNL there."); return false; }
  } else {
    body.city = document.getElementById("pm-city").value;
  }
  try {
    const data = await api("POST", "/me/market", body);
    state.user = data.user;
    render();
  } catch (err) {
    errBox(err.message);
  }
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
  if (isFoundingBusiness(u)) return renderBusinessFoundingStatus();
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
// Creator standing badges (ladder v2 + SIGNL Elite, Jeff,
// 2026-10-21): the server computes them (user.badges on the public
// payload, card.badges in discovery, creator.badges in the
// applicant stack); this only renders them.
function badgesHtml(badges) {
  if (!badges || !badges.length) return "";
  return badges.map((b) => b.kind === "elite"
    ? ' <span class="badge elite">SIGNL Elite</span>'
    : ` <span class="badge tier">${esc(b.name)}</span>`).join("");
}

// The ladder block inside Grow your roster: badges earned, the
// pending unlock, the distance to the next badge, and Elite. Copy
// is plain on purpose (Jeff): badges and points, no guarantees,
// and points are priority because points set the order businesses
// see.
function ladderHtml(u) {
  const l = u && u.ladder;
  if (!l) return "";
  const earned = (l.badges || []).filter((b) => b.kind === "milestone");
  let out = `<p class="small" style="margin-top:10px"><strong>Referral badges:</strong> approved referrals earn badges and bonus Momentum points. 1 approved referral: Connector badge, +25 points. 3: Super Connector, +50. 5: Roster Builder, +75. 10: City Lead, +150.</p>`;
  if (earned.length) out += `<p class="small">Your badges: ${earned.map((b) => esc(b.name)).join(" &middot; ")}</p>`;
  const pending = (l.milestones || []).find((m) => m.state === "pending_unlock");
  if (pending) {
    out += `<p class="small">Your ${esc(pending.name)} badge unlocks when @${esc(pending.trippingHandle || "your referral")} delivers their first post.</p>`;
  } else if (l.next) {
    out += `<p class="small">${l.next.needed} more approved ${l.next.needed === 1 ? "referral" : "referrals"} to your next badge: ${esc(l.next.name)}.</p>`;
  }
  if (l.elite && l.elite.qualified) out += `<p class="small"><span class="badge elite">SIGNL Elite</span> You hold SIGNL Elite: 10 or more on-time posts and a 4.5+ rating from 5 or more businesses.</p>`;
  return out;
}

function paidLaneBadgesHtml(p) {
  if (!p) return "";
  let out = "";
  if (p.paidRate) out += ` <span class="badge tier">Paid bookings: $${fmtPrice(p.paidRate)}</span>`;
  if (p.licensingFee) out += ` <span class="badge tier">Licenses posts: $${fmtPrice(p.licensingFee)}</span>`;
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

// The business's own referral program, tied in (Jeff,
// 2026-10-25). The server sends {url, code, note} only when
// the business has set a link or a code, so this renders
// nothing at all for businesses without one. Any rewards are
// the business's program under its own terms; SIGNL never
// runs or guarantees them.
function referralProgramBlockHtml(prog) {
  if (!prog || (!prog.url && !prog.code)) return "";
  return `<div class="showcase-block"><h4>This business runs its own referral program</h4>
    ${prog.note ? `<p class="small" style="margin:0 0 4px"><strong>From the business:</strong> ${esc(prog.note)}</p>` : ""}
    ${prog.url ? `<p class="small" style="margin:0">Referral link: <a href="${esc(prog.url)}" target="_blank" rel="noopener">${esc(prog.url)}</a></p>` : ""}
    ${prog.code ? `<p class="small" style="margin:0">Referral code: <strong>${esc(prog.code)}</strong></p>` : ""}
    <p class="small muted" style="margin:4px 0 0">Include the link in your caption or bio, or the code in your caption, so the business can track the bookings your post sends them. Any rewards come from the business's own program, under its terms, on top of your SIGNL comp or pay. SIGNL does not run or guarantee their program.</p></div>`;
}

// Book a paid visit at the creator's listed rate (real surface).
// Paid booking confirm sheet (UX redesign section 9): the old
// flow chained a native confirm() and a native prompt(), the same
// silent-gate pattern that killed the tester and close buttons
// (a suppressed dialog books nothing and says nothing). The sheet
// shows the full math and the honest payment state before anything
// is booked; Cancel books nothing and sends nothing.
function bookPaidVisit(creatorId) {
  const c = (state.discover || []).find((x) => x.userId === creatorId);
  const p = c && c.profile ? c.profile : {};
  const rate = p.paidRate;
  if (!rate) { alert("That creator has not listed a paid rate."); return; }
  const total = Math.round(rate * 1.03 * 100) / 100;
  const net = Math.round(rate * 0.97 * 100) / 100;
  closePaidSheet();
  const el = document.createElement("div");
  el.id = "paid-sheet";
  el.className = "sheet-overlay";
  el.innerHTML = `
  <div class="sheet" role="dialog" aria-label="Book a paid visit">
    <strong>Book a paid visit with ${esc(c ? c.name : "this creator")}</strong>
    <p class="small" style="margin:10px 0 2px">Listed rate: <strong>$${fmtPrice(rate)}</strong></p>
    <p class="small" style="margin:2px 0">You pay <strong>$${fmtMoney(total)}</strong> (rate + 3%)</p>
    <p class="small" style="margin:2px 0">They keep <strong>$${fmtMoney(net)}</strong> (97%)</p>
    <p class="small" style="margin:2px 0">Includes the standard license: repost + ad use for 90 days from the post date.</p>
    ${paymentsLive()
      ? (cardOnFileView()
        ? `<p class="small muted">Your ${esc(brandName(cardOnFileView().brand))} &middot;&middot;&middot;&middot;${esc(cardOnFileView().last4)} is charged $${fmtMoney(total)} when you book. SIGNL holds it and releases the creator's share after the post is live and the 48 hour hold passes.</p>`
        : `<p class="small muted">Paid bookings charge a card on file, held by SIGNL until the post is live. Add yours once and every paid booking confirms in one tap.</p>`)
      : `<p class="small muted">No card is charged in the app yet. This records the booking and holds the amount in the app ledger. It is released after the post is live and the 48 hour hold passes.</p>`}
    ${growthNudgeHtml()}
    <div class="field"><label>Key points for the creator (optional)</label><textarea id="paid-brief" rows="3" maxlength="500" placeholder="What to feature, names, dates"></textarea><p class="small muted">${PAID_BRIEF_GUIDANCE}</p></div>
    <button class="btn" style="width:100%" id="paid-sheet-book">${paymentsLive() && !cardOnFileView() ? "Add a card to book" : "Book paid visit"}</button>
    <button class="btn ghost" style="width:100%;margin-top:8px" id="paid-sheet-cancel">Cancel</button>
  </div>`;
  document.body.appendChild(el);
  document.getElementById("paid-sheet-cancel").onclick = () => closePaidSheet();
  el.addEventListener("click", (e) => { if (e.target === el) closePaidSheet(); });
  document.getElementById("paid-sheet-book").onclick = async () => {
    if (paymentsLive() && !cardOnFileView()) { closePaidSheet(); addBusinessCard(); return; }
    const briefEl = document.getElementById("paid-brief");
    const paidBrief = briefEl ? briefEl.value.trim().slice(0, 500) : "";
    closePaidSheet();
    try {
      const data = await api("POST", "/bookings/paid", { creatorId, ...(paidBrief ? { paidBrief } : {}) });
      state.tab = "Visits & Posts";
      render();
      showBookingCard(data.booking, "Paid visit booked", data.booking.paidLane ? data.booking.paidLane.paymentNote : "");
    } catch (err) { alert(err.message); }
  };
}

function closePaidSheet() {
  const el = document.getElementById("paid-sheet");
  if (el) el.remove();
  return false;
}

// Preview twin of the paid booking: a simulation with the real fee
// math, zero writes (the server route enforces it).
async function previewPaidBooking(creatorId) {
  try {
    const data = await api("POST", "/admin/preview/paid-booking", { creatorId });
    const bk = data.booking;
    // The result renders as a sheet in the booking-card family,
    // not a native alert: the preview is a presenter surface and
    // every other preview action answers in the app's own UI
    // (perfection pass, 2026-10-26).
    dismissBookingCard();
    const el = document.createElement("div");
    el.id = "booking-card";
    el.className = "booking-card";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Preview paid booking");
    el.innerHTML = `
    <div class="flex-between">
      <strong>Paid booking preview</strong>
      <button type="button" class="linklike" onclick="dismissBookingCard()">Dismiss</button>
    </div>
    <p class="small muted" style="margin:6px 0 0">Simulation: nothing is booked, charged or sent.</p>
    <div class="mt">
      <div class="flex-between"><span class="small">Creator rate</span><strong>$${fmtMoney(bk.rate)}</strong></div>
      <div class="flex-between"><span class="small">You pay (rate + 3%)</span><strong>$${fmtMoney(bk.businessTotal)}</strong></div>
      <div class="flex-between"><span class="small">Creator keeps (97% of their rate)</span><strong>$${fmtMoney(bk.creatorNet)}</strong></div>
      <div class="flex-between"><span class="small">SIGNL fee, split evenly</span><strong>$${fmtMoney(bk.platformFee)}</strong></div>
    </div>
    <p class="small" style="margin:10px 0 0">Held by SIGNL until the post is live.</p>
    <p class="small" style="margin:2px 0 0">Includes the standard license: repost + ad use for 90 days from the post date.</p>
    ${state.preview && state.preview.planId === "self-service" ? `<p class="small muted">Growth is built for paid work and reuse: every license and renewal tracked in one library, and priority access to the creators you license.</p>` : ""}
    ${bk.paymentNote ? `<p class="small muted">${esc(bk.paymentNote)}</p>` : ""}
    ${bk.note ? `<p class="small muted">${esc(bk.note)}</p>` : ""}`;
    document.body.appendChild(el);
  } catch (err) { alert(err.message); }
}

// Business rates the creator after a completed visit (the post
// proof is in). One rating per booking, not editable; it feeds
// the creator's star rating shown next to their Momentum points.
// Ratings never move anyone's Momentum points.
async function submitCreatorReview(e, bookingId) {
  e.preventDefault();
  const stars = document.getElementById("crev-stars-" + bookingId).value;
  const comment = document.getElementById("crev-comment-" + bookingId).value;
  try {
    await api("POST", `/bookings/${bookingId}/review`, { stars: Number(stars), comment });
    loadMyVisits("business");
  } catch (err) { alert(err.message); }
  return false;
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
    return `<div class="showcase-block"><h4>SIGNL track record</h4><p class="muted">New to SIGNL — no visits yet.${card.foundingBand ? ` Founding creator, first ${card.foundingBand} in ${esc(card.market || "")}.` : ""}</p></div>`;
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

// Business ratings appear only when a real rating exists (a
// business rated a completed visit). The headline reads the
// server-computed ratingAvg / ratingCount; an unrated creator
// renders nothing here at all, never a zero. Nothing is ever
// seeded or averaged in.
function reviewsHtml(card) {
  const sum = card.reviewSummary || { count: 0, average: null };
  const avg = card.ratingAvg !== undefined && card.ratingAvg !== null ? card.ratingAvg : sum.average;
  const count = card.ratingCount !== undefined ? card.ratingCount : sum.count;
  if (!count || avg === null || avg === undefined) return "";
  const items = (card.reviews || []).map((r) => `
    <div class="review-item">
      <div>${starsHtml(r.stars)} <strong>${esc(r.businessName)}</strong> <span class="muted small">${esc(fmtDate(r.createdAt))}</span></div>
      ${r.comment ? `<p style="margin:6px 0 0">${esc(r.comment)}</p>` : ""}
    </div>`).join("");
  return `<div class="showcase-block"><h4>Business reviews</h4>
    <p>${starsHtml(avg)} <strong>${esc(String(avg))}</strong> average rating from ${count} business rating${count === 1 ? "" : "s"} after completed visits.</p>
    ${items}</div>`;
}

function creatorShowcaseHtml(card) {
  return bestWorkHtml(card.bestWork) + trackRecordHtml(card) + reviewsHtml(card);
}

// The full creator profile view: what a business opens from a
// discovery card (and what the admin preview opens). Built entirely
// from the same card payload discovery returns, so the detail view
// can never disagree with the card.
function creatorProfileDetailHtml(c, preview, opts) {
  // Admin review mode (Jeff, 2026-10-26): the same profile a
  // business sees, rendered from the Admin Requests queue. The
  // business actions (offers, Later, Not a fit) are replaced by
  // the way back to the queue; everything else is byte-identical.
  const adminView = !!(opts && opts.admin);
  const p = c.profile || {};
  const localTxt = p.localAudiencePct === null || p.localAudiencePct === undefined
    ? "Local audience not reported yet"
    : `${p.localAudiencePct}% local audience <span class="badge info">${esc(p.localAudienceSource || "Self-reported")}</span>`;
  const initial = esc((c.name || "?").trim().charAt(0).toUpperCase() || "?");
  return `
  <div class="panel">
    <p><button class="btn small-btn ghost" onclick="${adminView ? "adminBackToRequests()" : preview ? "previewBackToResults()" : "backToDiscover()"}">&larr; Back to ${adminView ? "Requests" : "results"}</button></p>
    <div class="creator-card full">
      <div class="cc-photo${c.photoUrl ? "" : " no-photo"}">
        ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : `<div class="cc-mono"><span>${initial}</span></div>`}
        ${p.tierBand ? `<span class="cc-tier">${esc(p.tierBand)}</span>` : ""}
        ${p.paidRate ? `<span class="cc-paid">Paid bookings: $${fmtPrice(p.paidRate)}</span>` : ""}${p.licensingFee ? ` <span class="cc-paid">Licenses posts: $${fmtPrice(p.licensingFee)}</span>` : ""}
      </div>
      ${galleryRowHtml(c.photos)}
      <div class="cc-body">
        <div class="cc-id">
          <div class="cc-name">${esc(c.name)}</div>
          ${ccHandleHtml(p)}
          <div class="cc-chips">
            <span class="cc-chip market">${esc(marketDisplayName(c.market))}</span>
            ${c.city ? `<span class="cc-chip">${esc(c.city)}</span>` : ""}
            ${c.neighborhood ? `<span class="cc-chip">${esc(c.neighborhood)}</span>` : ""}
            ${campusBadgeHtml(c) ? `<span class="cc-chip">${esc(c.campusBadge || (c.profile && c.profile.campusBadge) || "")}</span>` : ""}
            ${c.foundingBand ? `<span class="cc-chip">First ${c.foundingBand} founding</span>` : ""}
          </div>
        </div>
        <p>${scoreBadge(c.localImpactScore)}${p.openToPaidCampaigns ? ` <span class="badge tier">Open to paid campaigns</span>` : ""}${paidLaneBadgesHtml(p)}${c.momentum && c.momentum.points ? ` <span class="badge info">Momentum ${c.momentum.points} pts</span>` : ""}${badgesHtml(c.badges)}</p>
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
    ${adminView ? `<div class="cta-row" style="justify-content:flex-start"><button class="btn ghost" onclick="adminBackToRequests()">Back to Requests</button></div>` : `<div class="cta-row" style="justify-content:flex-start">
      ${preview
        ? `<button class="btn" onclick="previewStartOffer('${c.userId}')">Send offer</button>${p.paidRate ? ` <button class="btn ghost" onclick="previewPaidBooking('${c.userId}')">Preview paid booking ($${fmtPrice(p.paidRate)})</button>` : ""}`
        : `<button class="btn" onclick="startOffer('${c.userId}')">Send offer</button>${p.paidRate ? ` <button class="btn" onclick="bookPaidVisit('${c.userId}')">Book paid visit ($${fmtPrice(p.paidRate)})</button>` : ""} <button class="btn ghost" onclick="openThread('${c.userId}')">Message</button>`}
      <button class="btn small-btn ghost" onclick="profileLater('${c.userId}', ${preview ? "true" : "false"})">Later</button>
      <button class="btn small-btn ghost" onclick="profileNotFit('${c.userId}', ${preview ? "true" : "false"})">Not a fit</button>
    </div>`}
    ${p.paidRate ? `<p class="small muted">Paid bookings: $${fmtPrice(p.paidRate)} &middot; you pay rate + 3% &middot; they keep 97% &middot; held until the post is live.</p>` : ""}
    ${preview ? `<p class="small muted">Preview: an offer sent from here is a simulation. It never reaches ${esc(c.name)} and nothing is saved.</p>` : ""}
    ${preview && c.trackRecord && c.trackRecord.postsDelivered > 0 ? `
    <div class="showcase-block"><h4>Ad use (preview)</h4>
      <p class="small muted">Ad use comes with the standard license: on a paid visit, a business can repost the post and run it as an ad for 90 days from the post date, and a comped post can be licensed the same way at the creator's listed fee with their approval. In the real app that logs the use, notifies the creator, and awards +25 Momentum. Here it is a simulation: nothing is logged and no points move.</p>
      <button class="btn small-btn ghost" onclick="previewAdUse('${c.userId}')">Use in an ad</button> <span id="pv-aduse-note" class="saved"></span>
    </div>` : ""}
  </div>`;
}

async function previewAdUse(userId) {
  const note = document.getElementById("pv-aduse-note");
  try {
    const data = await api("POST", "/admin/preview/ad-use", { creatorId: userId, planId: state.preview ? state.preview.planId : "growth", visitKind: "paid" });
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
  const ratingAvg = c.ratingAvg !== undefined && c.ratingAvg !== null ? c.ratingAvg : (c.reviewSummary ? c.reviewSummary.average : null);
  const ratingCount = c.ratingCount !== undefined ? c.ratingCount : (c.reviewSummary ? c.reviewSummary.count : 0);
  // Feed anatomy (UX redesign section 6): the rating joins the card
  // only once it rests on 3+ ratings; one or two ratings stay noise.
  const reviewLine = ratingCount >= 3 && ratingAvg !== null && ratingAvg !== undefined
    ? ` ${starsHtml(ratingAvg)} <strong>${esc(String(ratingAvg))}</strong> <span class="muted">(${ratingCount} rating${ratingCount === 1 ? "" : "s"})</span>`
    : "";
  // v2 .creator-card anatomy: one component for discovery, the public
  // profile hero, and the profile detail header (DESIGN-SYSTEM.md).
  // Same data, same words, same handlers; only the layout changed.
  const initial = esc((c.name || "?").trim().charAt(0).toUpperCase() || "?");
  return `
  <div class="creator-card${c.standing === "paused" ? " paused" : ""}">
    <div class="cc-photo${c.photoUrl ? "" : " no-photo"}">
      ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : `<div class="cc-mono"><span>${initial}</span></div>`}
      ${p.tierBand ? `<span class="cc-tier">${esc(p.tierBand)}</span>` : ""}
      ${p.paidRate ? `<span class="cc-paid">Paid bookings: $${fmtPrice(p.paidRate)}</span>` : ""}${p.licensingFee ? ` <span class="cc-paid">Licenses posts: $${fmtPrice(p.licensingFee)}</span>` : ""}
    </div>
    <div class="cc-id">
      <div class="cc-name">${esc(c.name)}</div>
      ${p.primaryPlatform && p.primaryPlatform !== "instagram" ? ccHandleHtml(p) : `<div class="cc-handle">@${esc(p.handle || "")}</div>`}
      <div class="cc-chips">
        <span class="cc-chip market">${esc(marketDisplayName(c.market))}</span>
        ${c.city ? `<span class="cc-chip">${esc(c.city)}</span>` : ""}
        ${c.neighborhood ? `<span class="cc-chip">${esc(c.neighborhood)}</span>` : ""}
        ${campusBadgeHtml(c) ? `<span class="cc-chip">${esc(c.campusBadge || (c.profile && c.profile.campusBadge) || "")}</span>` : ""}
        ${c.foundingBand ? `<span class="cc-chip">First ${c.foundingBand} founding</span>` : ""}
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
    <p>${scoreBadge(c.localImpactScore)}${p.openToPaidCampaigns ? ` <span class="badge tier">Open to paid campaigns</span>` : ""}${paidLaneBadgesHtml(p)}${c.momentum && c.momentum.points ? ` <span class="badge info">Momentum ${c.momentum.points} pts</span>` : ""}${badgesHtml(c.badges)}</p>
    ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    ${p.compCategories && p.compCategories.filter((x) => x !== PAID_COMP).length ? `<p class="small muted">Open to comps: ${p.compCategories.filter((x) => x !== PAID_COMP).map(esc).join(", ")}</p>` : ""}
    ${p.bio ? `<p class="small muted">${esc(p.bio)}</p>` : ""}
    <p class="small">${socialLinksHtml(p)}</p>
    ${bestWorkHtml(c.bestWork, true)}
    ${trackLine || reviewLine ? `<div class="cc-track">${trackLine}${reviewLine}</div>` : ""}
    ${c.fit && c.fit.reasons && c.fit.reasons.length ? `<p class="small cc-fit"><strong>Why they fit:</strong> ${c.fit.reasons.slice(0, 2).map(esc).join(" &middot; ")}</p>` : ""}
    <p class="small muted">Every SIGNL comped visit: 1 post or reel + 1 story that shares the post within 48 hours, tracked as proof. Paid bookings carry the deliverables set in the booking's terms. Content rights follow the visit: comp visits are native share only; paid visits add repost and ad rights for 90 days.</p>
    <div class="cc-actions">
      ${opts.preview
        ? `<button class="btn small-btn" onclick="previewViewCreator('${c.userId}')">View profile</button>
           <button class="btn small-btn ghost" onclick="previewStartOffer('${c.userId}')">Send preview offer</button>${p.paidRate ? `
           <button class="btn small-btn ghost" onclick="previewPaidBooking('${c.userId}')">Preview paid booking ($${fmtPrice(p.paidRate)})</button>` : ""}`
        : `<button class="btn small-btn" onclick="startOffer('${c.userId}')">Send offer</button>${p.paidRate ? `
           <button class="btn small-btn" onclick="bookPaidVisit('${c.userId}')">Book paid visit ($${fmtPrice(p.paidRate)})</button>` : ""}
           <button class="btn small-btn ghost" onclick="openCreatorProfile('${c.userId}')">View profile</button>
           <button class="btn small-btn ghost" onclick="openThread('${c.userId}')">Message</button>
           <button class="heart ${c.isFavorite ? "on" : ""}" title="Save to favorites" onclick="toggleFav('${c.userId}')">${c.isFavorite ? "&#10084;" : "&#9825;"}</button>`}
    </div>
  </div>`;
}

// ---------- creator ----------

const LIVE_CREATOR_TABS = ["Dashboard", "Profile", "Offers", "My Visits", "Messages", "Earnings", "More", "Momentum", "Numbers", "Settings", "Help"];
const FOUNDING_TABS = ["Dashboard", "Profile", "Status", "More", "Momentum", "Numbers", "Messages", "Settings", "Help"];

function renderCreatorDash() {
  const u = state.user;
  const marketLive = !!(u.founding && u.founding.marketLive);
  if (!marketLive) { stopHomeCountdown(); return renderFoundingHome(); }
  let tab = state.tab || "Dashboard";
  if (!LIVE_CREATOR_TABS.includes(tab)) tab = "Dashboard";
  state.tab = tab;
  if (tab !== "Dashboard") stopHomeCountdown();
  let body = "";
  if (tab === "Dashboard") body = `<div id="creator-home" class="vx-stagger">${skelHtml("Loading your dashboard...", 2)}</div>`;
  if (tab === "Profile") body = wsHead("My profile", { chip: livePill("Live"), sub: "Your public creator profile. This is what businesses see when they find you.", subKey: "cr-profile" }) + creatorProfileHtml(u) + momentumHtml(u) + growRosterHtml(u);
  app.innerHTML = `<div class="wrap">
    ${standingBannerHtml(u)}
    <div id="tab-body">${body}</div></div>`;
  if (tab === "Dashboard") loadCreatorHome();
  if (tab === "Profile") { setTimeout(loadMyScore, 10); setTimeout(() => { setupUniversityAutocomplete("p-university", "p-university-results"); dragInit(); }, 10); }
  if (tab === "Offers") loadCreatorOffers();
  if (tab === "My Visits") loadMyVisits("creator");
  if (tab === "Messages") loadThreads();
  if (tab === "Earnings") renderEarningsTab();
  if (tab === "More") renderMoreScreen();
  if (tab === "Momentum") renderMomentumTab();
  if (tab === "Numbers") renderCreatorNumbers();
  if (tab === "Settings") renderSettingsTab();
  if (tab === "Help") renderHelpTab();
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
  const placeBadge = u.market === unlistedLabel() ? esc(u.city || u.market) : esc(marketDisplayName(u.market));
  let body = "";
  if (tab === "Dashboard") body = `<div id="founding-dash" class="vx-stagger">${skelHtml("Loading your dashboard...", 2)}</div>`;
  if (tab === "Status") body = `<h3 style="margin-top:0">Your founding status</h3><div id="founding-body">${skelHtml("Loading your founding profile...", 1)}</div>`;
  if (tab === "Profile") body = wsHead("My profile", { sub: "Your public creator profile. Complete profiles get booked first.", subKey: "cr-profile" }) + creatorProfileHtml(u);
  if (tab === "Status") body = wsHead("Status", { sub: "Where your founding enrollment stands." }) + body;
  app.innerHTML = `<div class="wrap">
    ${standingBannerHtml(u)}
    <div id="tab-body">${body}</div></div>`;
  if (tab === "Dashboard") loadFoundingDashboard();
  if (tab === "Status") loadFoundingStatus();
  if (tab === "Profile") { setTimeout(loadMyScore, 10); setTimeout(() => { setupUniversityAutocomplete("p-university", "p-university-results"); dragInit(); }, 10); }
  if (tab === "More") renderMoreScreen();
  if (tab === "Momentum") renderMomentumTab();
  if (tab === "Numbers") renderCreatorNumbers();
  if (tab === "Messages") loadThreads();
  if (tab === "Settings") renderSettingsTab();
  if (tab === "Help") renderHelpTab();
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
    const place = isUnl ? esc(unlistedPlace(f)) : esc(marketTalkNameClient(f.market));
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const firstName = (u.name || "").trim().split(" ")[0] || u.name || "";
    const totalAud = totalAudienceOf(card);
    const pctSet = !(p.localAudiencePct === null || p.localAudiencePct === undefined);
    const localReach = pctSet ? Math.round((totalAud * Number(p.localAudiencePct)) / 100) : null;
    const momPts = (u.momentum || {}).points || 0;
    // Sig's queue (V3): the real waiting items on this home,
    // computed from the records on screen.
    const queueItems = [];
    if (u.profileCompletion && !u.profileCompletion.complete) {
      queueItems.push({ text: "Finish your profile. Businesses can only find finished profiles.", btn: "Open profile", act: () => go("dashboard", "Profile") });
    }
    if (!queueItems.length) {
      queueItems.push({ text: isUnl ? `You are on the founding roster. ${f.city} opens when sign-ups pile up; we email you the moment it opens.` : `You are on the founding roster. ${marketTalkNameClient(f.market)} opens in the next ${f.launchWindow}; we email you the moment it opens.`, btn: "View status", act: () => go("dashboard", "Status") });
    }
    const fSteps = [
      { label: "Claim your profile", sub: "You are on the roster.", done: u.status === "approved" },
      { label: "Add the four basics", sub: "Home city, audience size, categories, local %.", done: !u.profileCompletion || u.profileCompletion.complete, btn: "Finish profile", act: () => go("dashboard", "Profile") },
      { label: "Set your paid rate", sub: "Comped visits work without it.", done: !!(u.creator && u.creator.paidRate), optional: true, btn: "Set my rate", act: () => go("dashboard", "Profile") },
      { label: "Apply to your first offer", sub: "Offers open when your market launches.", done: false },
    ];
    el.innerHTML = `
    ${wsHead("Home", { sub: "Start here. Sig shows you what needs you, in order.", subKey: "cr-home" })}
    <div class="home-greet"><div class="hg-hi">Hi, ${esc(firstName)}</div><div class="hg-line">${esc(greet)}. ${isUnl ? `${esc(f.city)} opens when sign-ups pile up. We email you the moment it opens.` : `${esc(marketTalkNameClient(f.market))} opens in the next ${esc(f.launchWindow)}. We email you the moment it opens.`}</div></div>
    ${sigQueueHtml(queueItems, { links: [] })}
    ${checklistHtml(fSteps)}
    <div class="wcard">
      <div class="kpi-label">Your local reach</div>
      <div class="kpi-num" style="font-size:3.3rem">${localReach === null ? "Not set" : fmtNum(localReach)}</div>
      <div class="kpi-sub">${pctSet ? `${p.localAudiencePct}% of your ${fmtNum(totalAud)} audience is local. Businesses rank creators by this number, not by follower count.` : "Add your local audience % in your profile and this fills in."}</div>
      ${pctSet ? "" : `<p style="margin:12px 0 0"><button class="btn small-btn ws-primary" onclick="return go('dashboard','Profile')">Add your local %</button></p>`}
    </div>
    <div class="kpi-grid c3">
      ${kpiCard("Total audience", fmtNum(totalAud), { sub: "Across your linked accounts" })}
      ${kpiCard("Momentum", fmtNum(momPts), { sub: "Points from invites, approvals and on-time posts" })}
      ${kpiCard("Local Impact Score", card.localImpactScore !== null && card.localImpactScore !== undefined ? String(card.localImpactScore) : "New", { sub: "Out of 100, from your profile and record" })}
    </div>
    <div class="wcard">
      <div class="flex-between">
        <div>
          <h3 style="margin:0">${esc(u.name)} <span class="muted">@${esc(p.handle || "")}</span></h3>
          <p class="muted small" style="margin:4px 0 0">${isUnl ? place : `${esc(marketDisplayName(f.market))} &middot; ${esc(f.city)}`}</p>
        </div>
        <span class="badge ok" style="font-size:0.95rem;padding:6px 14px">Founding Creator</span>
      </div>
      <p class="small">${p.localAudiencePct === null || p.localAudiencePct === undefined ? `Add your local audience % in your profile` : `${p.localAudiencePct}% local audience`} &middot; ${esc(p.tierBand || "")} tier &middot; ${fmtNum(totalAudienceOf(card))} total audience${f.priorityBand ? ` &middot; first ${f.priorityBand} founding` : ""}${campusBadgeHtml(card)}</p>
      <p style="margin-bottom:0">${scoreBadge(card.localImpactScore)}</p>
      <div class="home-actions"><button class="btn small-btn ghost" onclick="return go('dashboard','Status')">See your full status</button></div>
    </div>
    ${feedListHtml([
      { at: u.createdAt, icon: "status", acc: true, title: `Founding enrollment: ${u.status === "approved" ? "approved" : "in review"}`, meta: isUnl ? unlistedPlace(f) : marketDisplayName(f.market) },
      { icon: "pin", title: isUnl ? `${esc(f.city)} opens when sign-ups pile up` : `${esc(marketTalkNameClient(f.market))} opens in the next ${esc(f.launchWindow)}`, meta: `We email you at ${esc(u.email)} the moment it opens.` },
    ])}
    ${homePaidLaneHtml(u.creator)}
    <div class="wcard"><h3>Your funnel</h3><p class="wc-sub" style="margin:4px 0 0">Invites appear here once ${isUnl ? esc(f.city) : esc(marketTalkNameClient(f.market))} opens: invites received, visits booked, visits done, posts live. Nothing to count yet, and we do not chart zeroes.</p></div>
    ${momentumHtml(u)}
    ${growRosterHtml(u)}
    <h3 style="margin:22px 0 0">Your founding status</h3>
    <div id="founding-body">${skelHtml("Loading your founding profile...", 1)}</div>
    ${askSigRowHtml()}`;
    wireSigQueue(el, queueItems, []);
    wireChecklist(el, fSteps);
    loadFoundingStatus();
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
          <p class="muted small">${isUnl ? place : `${esc(marketDisplayName(f.market))} &middot; ${esc(f.city)}`}</p>
        </div>
        <span class="badge ok" style="font-size:0.95rem;padding:6px 14px">Founding Creator</span>
      </div>
      <p class="small">You are in. Know a creator who should be on the founding roster with you? ${shareBlockHtml(p.handle, isUnl ? (f.city || "") : (f.market || ""), "Share your invite")}</p>
      <div class="grid cols-2 mt">
        <div>
          ${card.photoUrl ? `<img class="profile-photo" src="${esc(card.photoUrl)}" alt="Your profile photo">` : `<div class="photo-placeholder">No photo yet. Add one in your profile below; businesses see it when ${isUnl ? esc(f.city) : esc(marketTalkNameClient(f.market))} opens.</div>`}
          ${p.localAudiencePct === null || p.localAudiencePct === undefined
            ? `<p>Local audience not reported yet. <a href="#" onclick="return go('dashboard','Profile')">Add your local audience %</a> in your profile: it is the number businesses look at first.</p>`
            : `<p>${p.localAudiencePct}% local audience <span class="badge info">${esc(p.localAudienceSource || "Self-reported")}</span></p>`}
          <p>${scoreBadge(card.localImpactScore)}</p>
          ${card.scoreComponents ? `<p class="small muted">Reliability ${card.scoreComponents.reliability} &middot; ${esc(card.scoreComponents.reliabilityBasis)}</p>` : ""}
        </div>
        <div>
          <p class="small"><strong>${fmtNum(totalAudienceOf(card))}</strong> total audience &middot; ${esc(p.tierBand || "")} tier ${p.avgViews ? "&middot; " + fmtNum(p.avgViews) + " typical views" : ""}</p>
          ${stackList(card).length ? `<p class="small">${stackChipsHtml(card)}</p>` : ""}
          ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}${campusBadgeHtml(card)}</p>` : campusBadgeHtml(card) ? `<p class="small">${campusBadgeHtml(card)}</p>` : ""}
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
      <h3 style="margin-top:0">${esc(marketTalkNameClient(f.market))} opens to businesses in the next ${esc(f.launchWindow)}</h3>
      <p>Your market is not taking business offers yet, and that is on purpose: SIGNL opens each market with its founding roster in place. The moment ${esc(marketTalkNameClient(f.market))} opens, we email you at <strong>${esc(state.user.email)}</strong>.</p>
      ${f.priorityBand ? `<p><span class="badge tier" style="font-size:0.95rem;padding:6px 14px">You are in the first ${f.priorityBand} founding creators in ${esc(marketTalkNameClient(f.market))}</span></p>
      <p class="muted">You signed up early, and it counts: when businesses search the ${esc(marketTalkNameClient(f.market))} roster, founding creators are ordered by sign-up time, earliest first.</p>` : ""}
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
    el.textContent = homeDurCore(diff) + (diff < 0 && el.dataset.mode === "post" ? " late" : "");
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

// Booking credential card (UX audit fix, 2026-10-22): a one-time
// visit code used to arrive in an alert(), gone the moment OK was
// tapped. It now lands on a persistent card (code + QR + the use-by
// line) that stays on screen across in-app navigation until the
// person dismisses it. The same code also lives under My Visits.
function showBookingCard(booking, heading, note) {
  if (!booking || !booking.code) return;
  dismissBookingCard();
  const el = document.createElement("div");
  el.id = "booking-card";
  el.className = "booking-card";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", heading || "Your visit is booked");
  el.innerHTML = `
    <div class="flex-between">
      <strong>${esc(heading || "You are booked")}</strong>
      <button type="button" class="linklike" onclick="dismissBookingCard()">Dismiss</button>
    </div>
    ${booking.title || booking.businessName ? `<p class="small muted" style="margin:6px 0 0">${booking.title ? esc(booking.title) : ""}${booking.title && booking.businessName ? " at " : ""}${booking.businessName ? esc(booking.businessName) : ""}</p>` : ""}
    <p class="small" style="margin:10px 0 0">The one-time visit code. The creator shows it at the visit; staff redeem it in the app and the 48 hour post clock starts at that moment.</p>
    <div class="code-display">${esc(booking.code)}</div>
    ${booking.id ? `<div class="qr-box" style="margin:0 auto"><img src="/api/bookings/${esc(booking.id)}/qr" alt="QR code for ${esc(booking.code)}" onerror="this.parentElement.style.display='none'"></div>` : ""}
    ${booking.redeemBy ? `<p class="small"><strong>Use by ${esc(fmtDate(booking.redeemBy))}</strong>. Come any time inside the window; no appointment needed.</p>` : ""}
    ${note ? `<p class="small muted">${esc(note)}</p>` : ""}
    <p class="small muted">The visit and its code are saved in your visits list, so this card is safe to dismiss.</p>`;
  document.body.appendChild(el);
}

function dismissBookingCard() {
  const el = document.getElementById("booking-card");
  if (el) el.remove();
  return false;
}

function homeActiveVisitHtml(b) {
  if (!b) {
    return `
  <section class="panel">
    <p class="ui-kicker">Active visit</p>
    <h3 class="home-h">No active visit right now</h3>
    <p class="small muted">Accepted visits, codes and post clocks live here.</p>
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
    <div class="home-count home-tick" data-mode="post" data-target="${esc(b.postDeadline || "")}">${esc(homeDurCore(diff))}${diff < 0 ? " late" : ""}</div>
    <p class="small muted">Post by ${esc(fmtDate(b.postDeadline))}. Paste the link in My Visits.</p>`;
  } else if (awaitingRedeem) {
    clockBlock = `
    <p class="small" style="margin-top:12px">Window closes <strong>${esc(fmtDate(b.redeemBy))}</strong> (<span class="countdown home-tick" data-target="${esc(b.redeemBy || "")}">${esc(homeDurCore(Date.parse(b.redeemBy || "") - Date.now()))}</span> left). Walk in any time. Your 48h clock starts at redemption.</p>`;
  } else if (b.post && lane && lane.escrowState === "held") {
    const releaseTxt = lane.proofAt ? fmtDate(new Date(Date.parse(lane.proofAt) + 48 * 3600 * 1000).toISOString()) : "48 hours after your post proof lands";
    clockBlock = `
    <p class="small" style="margin-top:12px"><strong>Post is in.</strong> Held money releases ${esc(releaseTxt)}.</p>`;
  }
  const codeBlock = b.codeStatus === "issued" ? `
    <div class="home-visit-grid">
      <div>
        <p class="small muted" style="margin-bottom:0">Show at the visit — staff redeem it and your 48h clock starts.</p>
        <div class="code-display">${esc(b.code)}</div>
        ${b.redeemBy ? `<p class="small"><strong>Use by ${esc(fmtDate(b.redeemBy))}</strong> — unused counts as a no-show.</p>` : ""}
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
    <p class="small muted" style="margin:0">Comp: ${esc(b.whatComped)} (cap $${fmtMoney(b.dollarCap)})${lane ? ` &middot; Your rate $${fmtPrice(lane.rate)}: you receive $${fmtMoney(lane.creatorNet)}` : ""}</p>
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
  const form = e.target;
  if (!submitBusy(form, true)) return false;
  try {
    const data = await api("POST", `/offers/${offerId}/accept`, {});
    refreshBadges();
    showBookingCard(data.booking, "You are booked");
    loadCreatorHome();
  } catch (err) { submitBusy(form, false); alert(err.message); }
  return false;
}

// The dashboard's open-offer action: applying is the open lane's
// one tap (the Offers board's Apply, same endpoint). The home
// re-renders after, and the card then reads Applied.
async function homeApplyOffer(offerId) {
  try {
    await api("POST", `/offers/${offerId}/apply`, {});
    refreshBadges();
    loadCreatorHome();
  } catch (err) { alert(err.message); }
}

// Opportunities picked for you: the same open offers the Offers
// tab lists, ordered the honest way: sent directly to you first,
// then the most spots still open. Every card spells out the deal
// (compensation, the Standard Visit deliverables, the business's
// plan rights, the window) before any accept button.
function homeOpportunitiesHtml(offers, u, bookings, applications) {
  // State before actions (perfection pass, 2026-10-26): a card
  // never offers an action the creator has already taken. A booked
  // offer reads Booked and points at My Visits; an open offer the
  // creator already applied to reads Applied; an open offer gets
  // Apply (open offers book by application, so the old Accept here
  // could only ever fail against the server's lane rule).
  const bookedOfferIds = new Set((bookings || []).filter((b) => b.offerId && b.status !== "cancelled" && b.status !== "expired").map((b) => b.offerId));
  const appliedOfferIds = new Set((applications || []).filter((a) => a.status === "applied" || a.status === "backfill_offered").map((a) => a.offerId));
  const pileHidden = new Set(pileOf("offers").hidden);
  const ranked = offers.filter((o) => !pileHidden.has(o.id)).slice().sort((a, b) => {
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
    <p class="small muted">Best fits land here first.</p>
  </section>`;
  }
  const cards = ranked.slice(0, 3).map((o) => {
    const rights = o.visitRights || rightsForVisit(o.kind);
    const left = Math.max(0, (o.spots || 0) - (o.bookedCount || 0));
    const actions = bookedOfferIds.has(o.id)
      ? `<span class="badge ok">Booked</span>
          <button class="btn small-btn ghost" onclick="return go('dashboard','My Visits')">My Visits</button>`
      : o.lane === "open"
        ? (appliedOfferIds.has(o.id)
          ? `<span class="badge info">Applied</span> <span class="small muted">Waiting on the business</span>`
          : `<button class="btn small-btn book" onclick="homeApplyOffer('${o.id}')">Apply</button>`)
        : `<form onsubmit="return homeAcceptOffer(event, '${o.id}')">
            <button class="btn small-btn book" type="submit">Accept</button>
          </form>`;
    return `
    <div class="card home-opp mb">
      <div class="flex-between"><strong>${esc(o.title)}</strong><span class="badge tier">${esc(o.businessName)}</span></div>
      ${o.creatorId ? `<p style="margin:8px 0 0"><span class="badge ok">Sent directly to you</span></p>` : ""}
      ${dealRowsHtml(o)}
      ${o.kind === "paid" && o.paidBrief ? `<p class="small"><strong>Key points:</strong> ${esc(o.paidBrief)}</p>` : ""}
      ${dealPlainWordsHtml(o)}
      <p class="small muted">${o.windowMode === "thisweek" ? "Visit this week — ends Sunday" : "Within 7 days of accepting"} &middot; ${left} of ${o.spots} spot${o.spots === 1 ? "" : "s"} left.${o.visitWindow ? ` Note from the business: ${esc(o.visitWindow)}` : ""}</p>
      <div class="slot-foot">
        <div><div class="slot-price">$${fmtPrice(o.kind === "paid" ? o.cashRate : o.dollarCap)}</div><div class="slot-note">${o.kind === "paid" ? "Rate" : "Comp value"}</div></div>
        <div class="slot-actions">
          ${actions}
        </div>
      </div>
      ${o.lane === "open" && !bookedOfferIds.has(o.id) && !appliedOfferIds.has(o.id) ? `<div class="offer-pile-row"><button type="button" class="btn small-btn ghost" onclick="cardLater('offers','${o.id}')">Later</button><button type="button" class="btn small-btn ghost" onclick="cardHide('offers','${o.id}')">Not for me</button></div>` : ""}
    </div>`;
  }).join("");
  return `
  <section class="panel">
    <p class="ui-kicker">Opportunities picked for you</p>
    <h3 class="home-h">Open offers in ${esc(marketTalkNameClient(u.market))}</h3>
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
  <section class="fld fld-mint" style="margin-top:52px">
    <p class="ui-kicker">Your local signal</p>
    <h3 class="home-h">The proof businesses see</h3>
    <div class="black-card" style="margin:14px 0 8px">
      <div style="font-size:3rem;font-weight:800;color:var(--mint);line-height:1">${p.localAudiencePct === null || p.localAudiencePct === undefined ? "—" : p.localAudiencePct + "%"}</div>
      <div style="font-weight:700;color:#fff;margin-top:5px">Local reach</div>
      <div class="muted small">Impact Score ${card && card.localImpactScore !== null && card.localImpactScore !== undefined ? card.localImpactScore + " / 100" : "pending"}</div>
    </div>
    ${comp ? `<div class="ui-row"><span class="k">Reliability</span><span class="v">${esc(String(comp.reliability))}</span></div>` : ""}
    <div class="ui-row"><span class="k">On-time delivery</span><span class="v">${tr.onTimePct === null || tr.onTimePct === undefined ? "No posts yet" : tr.onTimePct + "%"}</span></div>
    <div class="ui-row"><span class="k">Track record</span><span class="v">${tr.visitsCompleted || 0} visits &middot; ${tr.postsDelivered || 0} posts</span></div>
    <div class="ui-row"><span class="k">Register actions</span><span class="v">${tallyCount ? `${tallyCount} customers &middot; $${fmtMoney(tallyTotal)} rung up` : "None reported yet"}</span></div>
    ${delivered ? `<div class="ui-row"><span class="k">On-time streak</span><span class="v">${streak} in a row</span></div>
    <p class="small muted">+25 Momentum per 5-post on-time streak.</p>` : ""}
    <div class="home-actions"><button class="btn small-btn" onclick="return go('dashboard','Profile')">View your full profile</button></div>
  </section>`;
}

// ---------- Booking lanes: ONE live control, two homes ----------
// Jeff (2026-10-25): the dashboard panel was display-only, and in
// the profile the lanes were a bare checkbox read once at form
// submit plus a detached rate box. Tapping through the profile to
// turn lanes ON saved both lanes OFF: the "paid" switch a creator
// finds there is Paid cash campaigns (a campaign category, not paid
// bookings — bookings exist only when a rate is set), and the save
// re-sent whatever the comp box happened to hold. Lane state now
// has exactly one write path: this control, rendered identically
// in the dashboard lane panel and the profile's lane section.
// Every flip saves immediately through PATCH /me/profile with ONLY
// the lane field it changed, and the profile form no longer sends
// compOpen/paidRate at all, so a form save can never clobber lane
// state again.
function laneRateOf(c) {
  const r = Number(c && c.paidRate);
  return Number.isFinite(r) && r > 0 ? r : null;
}
// Stripe Connect (2026-10-26): the payout rail is live only when
// the server says payments are configured. Everything payout
// related renders from this flag: rail off, the paid lane reads
// exactly as it did before Connect existed.
function paymentsLive() {
  return !!(state.boot && state.boot.payments && state.boot.payments.connectLive);
}
function cardOnFileView() {
  const b = state.user && state.user.business && state.user.business.billing;
  return (b && b.card) || null;
}
function brandName(brand) {
  const b = String(brand || "card");
  return b.charAt(0).toUpperCase() + b.slice(1);
}
function laneCompLine(c) {
  return c && c.compOpen === false ? "off. You're paid-only — always fine." : "on. Businesses can comp you for honest posts.";
}
function lanePaidLine(c) {
  const rate = laneRateOf(c || {});
  if (!rate) return "not set. Flip the switch and set a rate (min $50).";
  const keep = Math.round(rate * 0.97 * 100) / 100;
  const total = Math.round(rate * 1.03 * 100) / 100;
  return `your rate $${fmtPrice(rate)} · you keep $${fmtMoney(keep)} (97%). Business pays $${fmtMoney(total)}.`;
}
function laneFeeOf(c) {
  const f = Number(c && c.licensingFee);
  return Number.isFinite(f) && f >= 1 ? f : null;
}
function laneFeeLine(c) {
  const fee = laneFeeOf(c || {});
  if (!fee) return "not set. Set a fee and businesses can license your comped posts for ads, only with your approval.";
  const keep = Math.round(fee * 0.97 * 100) / 100;
  return `your fee $${fmtPrice(fee)} · you keep $${fmtMoney(keep)} (97%) per license.`;
}
function laneFeeSave() {
  const inp = document.getElementById("lane-fee");
  const raw = inp ? inp.value.trim() : "";
  if (raw === "") { laneSave({ licensingFee: null }); return false; }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 1) {
    laneErr("Licensing fees start at $1, or leave it blank for no licensing.");
    if (inp) inp.focus();
    return false;
  }
  laneSave({ licensingFee: Math.round(v * 100) / 100 });
  return false;
}
function laneControlsHtml(c) {
  const compOn = !c || c.compOpen !== false;
  const rate = laneRateOf(c || {});
  const fee = laneFeeOf(c || {});
  return `<div class="lane-ctl" id="lane-controls">
    ${compOn && rate ? "" : `<div class="lane-bothrow"><button type="button" class="btn small-btn" onclick="return laneBothOn()">Turn both on</button></div>`}
    <div class="lrow lane-row"><input type="checkbox" class="sw lane-sw" id="lane-comp" ${compOn ? "checked" : ""} onchange="laneToggleComp(this)"><div><label class="lname" for="lane-comp">Comp visits</label> <span class="lline" id="lane-comp-line">— ${esc(laneCompLine(c || {}))}</span></div></div>
    <div class="lrow lane-row"><input type="checkbox" class="sw lane-sw" id="lane-paid" ${rate ? "checked" : ""} onchange="laneTogglePaid(this)"><div><label class="lname" for="lane-paid">Paid bookings</label> <span class="lline" id="lane-paid-line">— ${esc(lanePaidLine(c || {}))}</span></div></div>
    <div class="lane-rate" id="lane-rate-row" style="display:${rate ? "block" : "none"}">
      <label for="lane-rate">Your paid rate (min $50)</label>
      <div class="lane-rate-flex"><input type="number" id="lane-rate" min="50" step="1" inputmode="numeric" placeholder="150" value="${rate || ""}" onchange="laneRateAuto()"><button type="button" class="btn small-btn" onclick="return laneRateSave()">Save rate</button></div>
      <p class="small muted" id="lane-rate-note">${rate ? `At $${fmtMoney(rate)} you keep $${fmtMoney(Math.round(rate * 0.97 * 100) / 100)} (97%).` : "Paid bookings turn on when a rate is saved."}</p>
    </div>
    <div class="lrow lane-row"><div><span class="lname">Post licensing</span> <span class="lline" id="lane-fee-line">— ${esc(laneFeeLine(c || {}))}</span></div></div>
    <div class="lane-rate">
      <div class="lane-rate-flex"><input type="number" id="lane-fee" min="1" step="1" inputmode="numeric" placeholder="75" value="${fee || ""}"><button type="button" class="btn small-btn" onclick="return laneFeeSave()">Save fee</button></div>
      <p class="small muted">A business can ask to license one of your delivered comped posts for 90 days of reposting and ad use at this fee. You approve or decline every request; nothing runs without your yes. Leave blank to keep comped posts native-share only.</p>
    </div>
    <p class="small lane-err" id="lane-err" style="display:none"></p>
    ${payoutsStepHtml(c)}
  </div>`;
}
function laneErr(msg) {
  const e = document.getElementById("lane-err");
  if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; }
}
// Payout setup step (Stripe Connect, 2026-10-26): part of the
// paid lane only, and only once a rate is listed. Joining,
// claiming and comp visits never need it. The states are the
// server's plain words (never raw Stripe requirement codes), and
// the step is resumable: the button always reopens Stripe's
// hosted pages where the creator left off.
function payoutsStepHtml(c) {
  // The paid lane is "on" exactly when a rate is listed, the
  // same derivation the lane control itself uses.
  if (!laneRateOf(c || {})) return "";
  const p = c.payouts || { status: "not_started", ready: false, missing: [] };
  if (!paymentsLive()) {
    return `<div class="lane-payouts"><div class="lrow lane-row"><div><span class="lname">Payouts</span><span class="lline"> — setup opens when the paid lane goes live. Comp visits never need it.</span></div></div></div>`;
  }
  if (p.ready) {
    return `<div class="lane-payouts"><div class="lrow lane-row"><div><span class="lname">Payouts</span><span class="lline"> — <span class="badge ok">Payouts ready</span></span></div></div><p class="small muted">Paid bookings pay out to your bank after your post is live.</p></div>`;
  }
  if (p.status === "pending" || p.status === "restricted") {
    const missing = (p.missing || []).length ? ` Stripe still needs: ${esc(p.missing.join(", "))}.` : "";
    return `<div class="lane-payouts"><div class="lrow lane-row"><div><span class="lname">Payouts</span><span class="lline"> — almost there.${missing}</span></div></div><button type="button" class="btn small-btn" onclick="return startPayoutSetup()">Finish payout setup</button><p class="small muted">Your first payout can take longer while Stripe verifies you.</p></div>`;
  }
  return `<div class="lane-payouts"><div class="lrow lane-row"><div><span class="lname">Payouts</span><span class="lline"> — not set up. You can be booked at your rate, but the money cannot reach your bank until this is done.</span></div></div><button type="button" class="btn small-btn" onclick="return startPayoutSetup()">Set up payouts</button><p class="small muted">Two minutes on Stripe's secure pages: your bank details go to Stripe, never to SIGNL. Your first payout can take longer while Stripe verifies you.</p></div>`;
}
async function startPayoutSetup() {
  try {
    const data = await api("POST", "/me/payouts/start", {});
    if (data && data.url) { window.location.href = data.url; return false; }
    laneErr("Payout setup could not open. Try again.");
  } catch (err) { laneErr((err && err.message) || "Payout setup could not open. Try again."); }
  return false;
}
// Business card on file (Stripe Connect, 2026-10-26): opens
// Stripe Checkout in setup mode; the saved card lands on the
// record through the webhook and shows under Plan.
async function addBusinessCard() {
  try {
    const data = await api("POST", "/billing/card", {});
    if (data && data.url) { window.location.href = data.url; return false; }
    alert("Card setup could not open. Try again.");
  } catch (err) { alert((err && err.message) || "Card setup could not open. Try again."); }
  return false;
}
function cardOnFileSectionHtml() {
  const card = cardOnFileView();
  if (card) {
    return `<div class="mt"><p><span class="badge ok">Card on file</span> <strong>${esc(brandName(card.brand))} &middot;&middot;&middot;&middot;${esc(card.last4)}</strong></p><p class="small muted">Paid bookings charge this card when you book. SIGNL holds the money until the creator's post is live.</p><button class="btn ghost small-btn" onclick="return addBusinessCard()">Update card</button></div>`;
  }
  return `<div class="mt"><p><strong>No card on file.</strong></p><p class="small muted">Paid bookings need a card: it is charged when you book, SIGNL holds the money until the creator's post is live, and the creator is paid from it.</p><button class="btn small-btn" onclick="return addBusinessCard()">Add a card</button></div>`;
}
// Held / released money status on a booking card (Stripe
// Connect, 2026-10-26). Renders nothing unless real funds ride
// on the booking; the ledger states above it are unchanged.
function fundsStatusHtml(lane, role) {
  const f = lane && lane.funds;
  if (!f) return "";
  if (role === "creator") {
    if (f.state === "released") return `<br><span class="muted">Released · on its way to your bank.</span>`;
    if (f.state === "refunded") return `<br><span class="muted">Refunded to the business in full.</span>`;
    if (f.state === "needs_card" || f.state === "charge_failed") return `<br><span class="muted">SIGNL is sorting out the business's card with the business.</span>`;
    if (f.blockedReason === "payouts_not_ready") return `<br><span class="muted">Held · finish payout setup under Profile to release it.</span>`;
    return `<br><span class="muted">Held · releases when your post is live.</span>`;
  }
  if (f.state === "released") return `<br><span class="muted">Paid · released to the creator.</span>`;
  if (f.state === "refunded") return `<br><span class="muted">Paid · refunded in full.</span>`;
  if (f.state === "needs_card" || f.state === "charge_failed") return `<br><span class="muted">Add a card under Plan to complete this booking's payment.</span>`;
  return `<br><span class="muted">Paid · held until the post is live.</span>`;
}
function rerenderLaneControls() {
  const host = document.getElementById("lane-controls");
  if (!host || !state.user || !state.user.creator) return;
  const rateInput = document.getElementById("lane-rate");
  const typed = rateInput ? rateInput.value : "";
  const row = document.getElementById("lane-rate-row");
  const rowOpen = !!row && row.style.display !== "none";
  host.outerHTML = laneControlsHtml(state.user.creator);
  if (rowOpen) {
    const r2 = document.getElementById("lane-rate-row");
    if (r2) r2.style.display = "block";
    if (typed && !laneRateOf(state.user.creator)) {
      const ni = document.getElementById("lane-rate");
      if (ni) ni.value = typed;
    }
  }
}
async function laneSave(patch) {
  laneErr("");
  try {
    const data = await api("PATCH", "/me/profile", patch);
    if (data && data.user) state.user = data.user;
    rerenderLaneControls();
    return true;
  } catch (err) {
    rerenderLaneControls();
    laneErr((err && err.message) || "That didn't save. Try again.");
    return false;
  }
}
function laneToggleComp(input) {
  laneSave({ compOpen: !!input.checked });
  return true;
}
function laneTypedRate() {
  const inp = document.getElementById("lane-rate");
  const v = inp ? Number(inp.value) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}
function laneOpenRateEntry(msg) {
  const row = document.getElementById("lane-rate-row");
  if (row) row.style.display = "block";
  const inp = document.getElementById("lane-rate");
  if (inp) inp.focus();
  const note = document.getElementById("lane-rate-note");
  if (note && msg) note.textContent = msg;
}
function laneTogglePaid(input) {
  if (!input.checked) { laneSave({ paidRate: null }); return true; }
  const rate = laneRateOf(state.user.creator || {}) || laneTypedRate();
  if (rate && rate >= 50) { laneSave({ paidRate: rate }); return true; }
  laneOpenRateEntry("Set a rate (min $50), then tap Save rate — paid bookings turn on.");
  return true;
}
function laneRateSave() {
  const v = laneTypedRate();
  if (!v || v < 50) {
    laneErr("Paid bookings need a rate of at least $50.");
    const inp = document.getElementById("lane-rate");
    if (inp) inp.focus();
    return false;
  }
  laneSave({ paidRate: Math.round(v * 100) / 100 });
  return false;
}
function laneRateAuto() {
  // Typing a valid rate while the paid switch is on saves it, so
  // the rate and the toggle land together.
  const sw = document.getElementById("lane-paid");
  const v = laneTypedRate();
  if (sw && sw.checked && v && v >= 50 && v !== laneRateOf(state.user.creator || {})) laneSave({ paidRate: Math.round(v * 100) / 100 });
  return true;
}
function laneBothOn() {
  const rate = laneRateOf(state.user.creator || {}) || laneTypedRate();
  if (rate && rate >= 50) { laneSave({ compOpen: true, paidRate: rate }); return false; }
  laneSave({ compOpen: true });
  laneOpenRateEntry("Comp is on. Set a rate (min $50), then tap Save rate — paid bookings turn on too.");
  return false;
}

// The paid lane panel, shown the same way in the founding home and
// the live Dashboard tab: the live lane control (the exact switches
// from the profile's lane section) plus the honest hold line.
function homePaidLaneHtml(creator, footerHtml) {
  return `
  <section class="panel">
    <p class="ui-kicker">Paid lane</p>
    <h3 class="home-h">Comp and paid, your choice</h3>
    ${laneControlsHtml(creator || {})}
    <p class="small muted">${paymentsLive() ? "Charged to the business's card at booking. Held until your post is live — released 48h after proof." : "Recorded in the app, no card charged. Held until your post is live — released 48h after proof."}</p>
    ${footerHtml || ""}
  </section>`;
}

function homeMoneyHtml(money) {
  return `
  <section class="panel tint">
    <p class="ui-kicker">Money</p>
    <h3 class="home-h">Cash and comps, kept separate</h3>
    <div class="home-money">
      <div class="hm-pile"><div class="hm-num">$${fmtMoney(money.released)}</div><div class="hm-lbl">Paid cash released</div></div>
      <div class="hm-pile"><div class="hm-num">$${fmtMoney(money.held)}</div><div class="hm-lbl">Held — releases 48h after proof</div></div>
      <div class="hm-pile"><div class="hm-num">$${fmtMoney(money.compValue)}</div><div class="hm-lbl">Comp value (not cash)</div></div>
    </div>
    ${money.refunded ? `<p class="small muted">$${fmtMoney(money.refunded)} went back to businesses from paid visits that resolved without delivery.</p>` : ""}
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
  <section class="panel tint">
    <p class="ui-kicker">Coming up</p>
    <h3 class="home-h">Your next deadlines</h3>
    ${rows || `<p class="small muted">Nothing scheduled.</p>`}
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
    <div class="stat-cell"><div class="stat-num"><em>${m.points}</em></div><div class="stat-lbl">Momentum points</div></div>
    <div class="stat-cell"><div class="stat-num">${p.localAudiencePct === null || p.localAudiencePct === undefined ? "Not set" : p.localAudiencePct + "%"}</div><div class="stat-lbl">Local reach</div></div>
    <div class="stat-cell"><div class="stat-num">${card && card.localImpactScore !== null && card.localImpactScore !== undefined ? card.localImpactScore : "New"}</div><div class="stat-lbl">Impact Score / 100</div></div>
    <div class="stat-cell"><div class="stat-num">${fmtNum(totalAudienceOf(card))}</div><div class="stat-lbl">Total audience</div></div>
  </div>
  ${homePaidLaneHtml(u.creator)}`;
}

// Creator home feed (Grin Feed pattern): date-grouped, chip
// filtered (All / Invites / Visits / Posts / Momentum). Events
// come from the home's real records; actions are closures kept
// in state.crFeedActs because the list re-renders on filtering.
let crFeedKind = "all";
function crFeedSet(kind) {
  crFeedKind = kind;
  const host = document.getElementById("cr-feed");
  if (host) host.innerHTML = crFeedHtml();
  return false;
}
function crFeedAct(i) {
  const act = (state.crFeedActs || [])[i];
  if (act) act();
  return false;
}
function crFeedHtml() {
  const kinds = [["all", "All"], ["applications", "Applications"], ["invites", "Invites"], ["visits", "Visits"], ["posts", "Posts"], ["licenses", "Licenses"]];
  const chips = `<div class="feed-chips">${kinds.map(([k, label]) => `<button type="button" class="fchip ${crFeedKind === k ? "on" : ""}" onclick="return crFeedSet('${k}')">${label}</button>`).join("")}</div>`;
  const all = state.crFeed || [];
  const shown = all.map((f, i) => ({ f, i })).filter(({ f }) => crFeedKind === "all" || f.kind === crFeedKind);
  if (!shown.length) return `${chips}<div class="feed-list"><div class="feed-empty"><div class="ec-t">Nothing here yet</div><div class="ec-s">Invites, visits, posts and licenses land here as they happen.</div></div></div>`;
  return chips + feedListHtml(shown.map(({ f, i }) => ({
    at: f.at,
    title: esc(f.title),
    meta: esc(f.meta || ""),
    icon: f.icon,
    acc: f.kind === "momentum",
    act: f.btn ? { label: f.btn, onclick: `return crFeedAct(${i})` } : null,
  })));
}

async function loadCreatorHome() {
  const el = document.getElementById("creator-home");
  if (!el) return;
  const u = state.user;
  try {
    await ensureDeckState();
    const [bkData, offData, fData, appData, openData, lrData] = await Promise.all([
      api("GET", "/bookings"),
      api("GET", "/offers"),
      api("GET", "/me/founding"),
      api("GET", "/applications").catch(() => ({ applications: [] })),
      api("GET", "/open-offers").catch(() => ({ offers: [] })),
      api("GET", "/license-requests").catch(() => ({ licenseRequests: [] })),
    ]);
    if (!document.getElementById("creator-home")) return; // navigated away mid-load
    const bookings = bkData.bookings || [];
    const offers = offData.offers || [];
    const applications = appData.applications || [];
    const openOffers = openData.offers || [];
    const lrs = lrData.licenseRequests || [];
    state.licenseRequests = lrs;
    const card = fData.card || {};
    const money = homeMoney(bookings);
    const m = u.momentum || { points: 0 };
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const firstName = (u.name || "").trim().split(" ")[0] || u.name || "";
    const cprof = card.profile || {};
    const totalAud = totalAudienceOf(card);
    const pctSet = !(cprof.localAudiencePct === null || cprof.localAudiencePct === undefined);
    const localReach = pctSet ? Math.round((totalAud * Number(cprof.localAudiencePct)) / 100) : null;
    const pc = u.profileCompletion;
    const gateDone = !pc || pc.complete;
    const bookedOfferIds = new Set(bookings.filter((b) => b.offerId && b.status !== "cancelled" && b.status !== "expired").map((b) => b.offerId));
    const invites = offers.filter((o) => o.lane !== "open" && !bookedOfferIds.has(o.id));
    const pendingLic = lrs.filter((l) => l.status === "pending");
    state.waitCounts = state.waitCounts || {};
    state.waitCounts.crInvites = invites.length;
    state.waitCounts.crLicense = pendingLic.length;

    // Sig's queue (spec §4.2/§4.4): deadlines first, then
    // people waiting, then new opportunities, then setup gaps.
    const now = Date.now();
    const items = [];
    const add = (cls, at, text, btn, act) => items.push({ cls, at: at || now, text, btn, act });
    const postDue = bookings.filter((b) => b.redeemedAt && !b.post && b.postDeadline && (Date.parse(b.postDeadline) - now) <= 48 * 3600000 && b.status !== "cancelled")
      .sort((a, b) => (Date.parse(a.postDeadline) || 0) - (Date.parse(b.postDeadline) || 0));
    if (postDue.length) {
      const b = postDue[0];
      const overdue = Date.parse(b.postDeadline) < now;
      add(1, Date.parse(b.postDeadline) || now, `Your post for ${b.businessName} is ${overdue ? "overdue" : "due " + dueDayWords(b.postDeadline)}.`, "Add post link", () => { state.visitsSeg = "needs"; state.visitFocus = b.id; go("dashboard", "My Visits"); });
    }
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const dayOffset = (iso) => { const t = Date.parse(iso || ""); if (Number.isNaN(t)) return null; const d0 = new Date(t); d0.setHours(0, 0, 0, 0); return Math.round((d0.getTime() - startOfDay.getTime()) / 86400000); };
    const visitSoon = bookings.filter((b) => !b.redeemedAt && !b.post && b.status !== "cancelled" && b.status !== "expired")
      .map((b) => ({ b, off: dayOffset(b.visitDate || b.redeemBy) }))
      .filter((x) => x.off !== null && x.off >= 0 && x.off <= 1)
      .sort((a, b) => a.off - b.off);
    if (visitSoon.length) {
      const { b, off } = visitSoon[0];
      add(1, now, `Visit ${off === 0 ? "today" : "tomorrow"}: ${b.title} at ${b.businessName}.`, "View visit", () => { state.visitsSeg = "upcoming"; state.visitFocus = b.id; go("dashboard", "My Visits"); });
    }
    state.waitCounts.crVisits = postDue.length + visitSoon.length;
    if (pendingLic.length) add(2, now, `${pendingLic.length} license request${pendingLic.length === 1 ? " is" : "s are"} waiting on you.`, "Review", () => go("dashboard", "Earnings"));
    if (invites.length) {
      add(2, now, invites.length === 1 ? `${invites[0].businessName} invited you: "${invites[0].title}".` : `${invites.length} businesses invited you.`, "See invites", () => { state.crOffersSeg = "invited"; go("dashboard", "Offers"); });
    }
    const answered = applications.filter((a) => a.status !== "applied" && a.decidedAt && now - Date.parse(a.decidedAt) < 3 * 86400000)
      .sort((a, b) => (Date.parse(b.decidedAt) || 0) - (Date.parse(a.decidedAt) || 0));
    if (answered.length) {
      const a = answered[0];
      add(2, Date.parse(a.decidedAt) || now, `Your application to "${a.offerTitle || a.title || "an offer"}" was answered.`, "View", () => { state.crOffersSeg = "applied"; go("dashboard", "Offers"); });
    }
    let seenMark = 0;
    try { seenMark = Number(localStorage.getItem("signl-offers-seen") || 0); } catch (e) { /* private mode */ }
    const freshOffers = openOffers.filter((o) => (Date.parse(o.createdAt) || 0) > seenMark);
    if (openOffers.length && (freshOffers.length || !seenMark)) {
      const n = freshOffers.length || openOffers.length;
      add(3, now, seenMark ? `${n} new offer${n === 1 ? "" : "s"} near you.` : `${openOffers.length} offer${openOffers.length === 1 ? "" : "s"} open near you in ${u.city || marketTalkNameClient(u.market)}.`, "See offers", () => { state.crOffersSeg = "foryou"; go("dashboard", "Offers"); });
    }
    if ((money.held || 0) > 0) add(3, now, `A paid booking is earning: $${fmtMoney(money.held)} held until the post is live.`, "See earnings", () => go("dashboard", "Earnings"));
    if (pc && !pc.complete) add(4, now, `Your profile is missing essentials (${pc.requiredDone} of ${pc.requiredTotal} done). Businesses cannot find you yet.`, "Finish profile", () => go("dashboard", "Profile"));
    const paidRate = u.creator && u.creator.paidRate;
    if (!paidRate) add(4, now, "Set your paid rate so businesses can book you paid.", "Set my rate", () => go("dashboard", "Profile"));
    items.sort((a, b) => a.cls - b.cls || a.at - b.at);
    const queue = items.slice(0, 7);

    // The launch checklist (spec §4.6): the paid-rate step is
    // optional; the card retires when the other three are done.
    const steps = [
      { label: "Claim your profile", sub: "You are on the roster.", done: true },
      { label: "Add the four basics", sub: "Home city, audience size, categories, local %.", done: gateDone, btn: "Finish profile", act: () => go("dashboard", "Profile") },
      { label: "Set your paid rate", sub: "Comped visits work without it.", done: !!paidRate, optional: true, btn: "Set my rate", act: () => go("dashboard", "Profile") },
      { label: "Apply to your first offer", sub: "Flip through offers near you.", done: applications.length > 0 || bookings.length > 0, btn: "See offers", act: () => { state.crOffersSeg = "foryou"; go("dashboard", "Offers"); } },
    ];
    const greetLine = !gateDone ? "Let's finish your profile so businesses can find you." : (queue.length ? queue[0].text : "You're all caught up.");
    const snapCells = gateDone ? [
      { num: localReach === null ? "Not set" : fmtNum(localReach), label: "Your local reach" },
      { num: fmtNum(m.points || 0), label: "Momentum" },
      ...(money.released > 0 ? [{ num: `$${fmtMoney(money.released)}`, label: "Earned" }] : []),
    ] : null;
    const tier = cprof.tierBand || (u.creator && u.creator.tierBand) || "";
    const nextEarn = (m.checklist || []).find((i) => !i.done);
    const momentumCard = `<div class="wcard mom-card">
      <div class="flex-between"><div><div class="kpi-label">Momentum</div><div class="kpi-num" style="font-size:2.6rem">${fmtNum(m.points || 0)}</div></div>${tier ? `<span class="badge tier" style="font-size:1rem;padding:6px 14px">${esc(tier)}</span>` : ""}</div>
      <div class="kpi-sub">${m.points ? (nextEarn ? `Next: ${esc(nextEarn.label)} (+${nextEarn.points}).` : "Every way to earn is done. Keep the streak going.") : "Your Momentum starts with your first visit. Post on time and it climbs."}</div>
      <p style="margin:10px 0 0"><button class="btn small-btn ws-outline" onclick="return go('dashboard','Momentum')">See Momentum</button></p>
    </div>`;
    // Activity (§6.1): invites, applications, visits, posts,
    // licenses, Momentum gains, and reviews — from real records.
    const feed = [];
    for (const o of invites) feed.push({ kind: "invites", icon: "deck", at: o.createdAt, title: `Invite: ${o.title || "Untitled offer"}`, meta: `${o.businessName || ""}${o.kind === "paid" ? " · Paid booking" : " · Comped visit"}`, btn: "View", act: () => { state.crOffersSeg = "invited"; go("dashboard", "Offers"); } });
    for (const a of applications) feed.push({ kind: "applications", icon: "notice", at: a.createdAt, title: `Application sent: ${(a.offer && a.offer.title) || a.offerTitle || a.title || "an offer"}`, meta: a.status === "applied" ? "Waiting on the business" : a.status === "selected" ? "You're in" : "Not this time", btn: null });
    for (const b of bookings) {
      if (b.post) feed.push({ kind: "posts", icon: "visits", at: b.post.firstAt || b.post.updatedAt, title: `Post live: ${b.title}`, meta: `${b.businessName || ""} · ${b.state === "posted_on_time" ? "on time" : b.state === "posted_late" ? "late" : "delivered"}`, btn: "Open", act: () => { state.visitsSeg = "done"; state.visitFocus = b.id; go("dashboard", "My Visits"); } });
      else if (b.redeemedAt) feed.push({ kind: "visits", icon: "visits", at: b.redeemedAt, title: `Visit done: ${b.title}`, meta: `${b.businessName || ""} · post clock running`, btn: "Open", act: () => { state.visitsSeg = "needs"; state.visitFocus = b.id; go("dashboard", "My Visits"); } });
      else feed.push({ kind: "visits", icon: "visits", at: b.createdAt, title: `Visit booked: ${b.title}`, meta: `${b.businessName || ""} · code issued`, btn: "Open", act: () => { state.visitsSeg = "upcoming"; state.visitFocus = b.id; go("dashboard", "My Visits"); } });
      if (b.creatorReview) feed.push({ kind: "visits", icon: "star", at: b.creatorReview.createdAt || (b.post && b.post.firstAt), title: `${b.businessName} rated you ${b.creatorReview.stars} stars`, meta: b.creatorReview.comment || "", btn: null });
    }
    for (const l of lrs) feed.push({ kind: "licenses", icon: "play", at: l.createdAt, title: l.status === "pending" ? `License request from ${l.businessName}` : `License ${l.status}: ${l.businessName}`, meta: `Your fee $${fmtPrice(l.fee)} · 90 days`, btn: l.status === "pending" ? "Review" : null, act: () => go("dashboard", "Earnings") });
    for (const e of (m.ledger || [])) feed.push({ kind: "momentum", icon: "bolt", at: e.at, title: `${e.points > 0 ? "+" : ""}${e.points} Momentum`, meta: e.label || "", btn: null });
    feed.sort((x, y) => (String(y.at || "") < String(x.at || "") ? -1 : 1));
    state.crFeed = feed.slice(0, 14);
    state.crFeedActs = state.crFeed.map((f) => f.act || null);
    crFeedKind = "all";
    const caughtLinks = [
      { label: "See offers near you", act: () => { state.crOffersSeg = "foryou"; go("dashboard", "Offers"); } },
      { label: "Check your Momentum", act: () => go("dashboard", "Momentum") },
    ];
    el.innerHTML = `
    ${wsHead("Home", { sub: "Start here. Sig shows you what needs you, in order.", subKey: "cr-home" })}
    <div class="home-greet"><div class="hg-hi">Hi, ${esc(firstName)}</div><div class="hg-line">${esc(greetLine)}</div></div>
    ${strikeStatusHtml(u)}
    ${sigQueueHtml(queue, { links: caughtLinks })}
    ${checklistHtml(steps)}
    ${gateDone ? snapshotHtml(snapCells, "", "Numbers") : ""}
    ${momentumCard}
    <h3 style="margin:20px 0 0">Activity</h3>
    <div id="cr-feed">${crFeedHtml()}</div>
    ${askSigRowHtml()}`;
    wireSigQueue(el, queue, caughtLinks);
    wireChecklist(el, steps);
    renderBottomNav();
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
    ["snapchat", "Snapchat followers", "p-stack-snapchat"],
  ];
  return `
  <div class="panel">
    <div class="flex-between">
      <div>
        <h3 style="margin:0">${esc(u.name)} <span class="muted">@${esc(c.handle || "")}</span></h3>
        <p class="muted small">${esc(marketDisplayName(u.market))} &middot; ${esc(u.city || "")}${c.neighborhood ? ` &middot; ${esc(c.neighborhood)}` : ""}</p>
      </div>
      <div id="my-score"><span class="badge info">Loading score...</span></div>
    </div>
    <p class="small muted">Your Local Impact Score is computed only from your stored profile and your real visit history on SIGNL. Your local audience figure shows as <strong>Self-reported</strong> until Instagram verification is available.</p>
    <p class="small muted">Your market is set from your application and cannot be changed here. Wrong market? Email hello@joinsignl.com and we will move it for you.</p>
    ${u.status === "approved" && c.handle ? `
    <div class="field"><label>Your public profile</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" readonly value="${esc(publicProfileUrl(u))}" onclick="this.select()" style="flex:1;min-width:220px">
        <button type="button" class="btn small-btn" onclick="return copyPublicProfile()">Copy link</button>
        <a class="btn small-btn ghost" href="${esc(publicProfileUrl(u))}" target="_blank" rel="noopener">View</a>
        <a class="btn small-btn ghost" href="${esc(publicProfileUrl(u))}/proof" target="_blank" rel="noopener">Listing proof sheet</a>
        <span id="pp-copied" class="saved"></span>
      </div>
      <p class="small muted">Share this link anywhere, including your Instagram bio. Visitors see your name, handle, market and neighborhood, tier, follower count, categories, local audience share, Local Impact Score, Momentum points, and founding standing. Your email and account details are never shown, and there is no public roster: this page exists only at your link.</p>
    </div>` : ""}
    <div id="form-error"></div>
    ${u.profileCompletion && !u.profileCompletion.complete ? `<div class="notice blue">Your profile is not finished yet. Still needed to go live: ${u.profileCompletion.items.filter((i) => i.required && !i.done).map((i) => esc(i.label)).join(", ")}. Fill in the fields below and save. Businesses cannot see you, and you cannot take offers, until your profile is finished.</div>` : ""}
    <form onsubmit="return doUpdateCreator(event)">
      <div class="fgroup tint">
      <p class="fg-kicker">The basics</p>
      <div class="field"><label>Your name</label><input id="p-name" value="${esc(u.name || "")}"><p class="small muted">Shown to businesses next to your handle. A quick claim starts with your handle here; put your real name in.</p></div>
      <div class="field"><label>Your photos</label>
        <div id="p-gallery">${galleryHtml(u)}</div>
        <p class="small muted">Up to 6 photos. The first is your cover: the one on your cards. Changes save as you make them. PNG, JPEG, or WebP, under 2.5 MB each.</p>
        <p class="small lane-err" id="gallery-err" style="display:none"></p>
      </div>
      <div class="form-2col">
        <div class="field"><label>Where is your main audience?</label>${platformChipsHtml("p-platform", c.primaryPlatform || "instagram", "syncPPlatform")}<p class="small muted" id="p-proof-note" style="display:${(c.primaryPlatform || "instagram") !== "instagram" ? "" : "none"}">${PROOF_DISCLOSURE}</p></div>
        <div class="field"><label>Your main handle</label><input id="p-handle" value="${esc(c.handle || "")}"><p class="small muted">Your handle on your main platform. Your public profile and claim links point there.</p></div>
        ${u.market === unlistedLabel()
          ? `<div class="field"><label>Your city (not an open market yet)</label><input id="p-city-text" value="${esc(u.city || "")}"></div>
             <div class="field"><label>Your country</label><input id="p-country-text" value="${esc(u.country || "")}"></div>
             <div class="field"><label>Your state or province (optional)</label><input id="p-state-text" value="${esc(u.state || "")}"></div>`
          : `<div class="field"><label>Home city (${esc(marketDisplayName(u.market))})</label><select id="p-city">${cityOptions(u.market, u.city || "")}</select></div>`}
      </div>
      <div class="field"><label>Your neighborhood or area</label><input id="p-neighborhood" value="${esc(c.neighborhood || "")}" placeholder="Optional, for example: Oceanfront, Ghent, Town Center" maxlength="80"><p class="small muted">Businesses search by neighborhood. Keep it to the area you actually post from.</p></div>
      <div class="field"><label>What do you do? (optional)</label>${professionChipsHtml("p-profession", c.profession || "", "syncRealtorFields")}<p class="small muted">Realtors: pick Real estate agent and the fields below appear. Your profile gains a Realtor badge, your neighborhoods, and your brokerage line.</p></div>
      <div id="p-realtor-block" style="display:${isRealtorProfile(c) ? "" : "none"}">
        <div class="field"><label>Your neighborhoods (up to 3)</label>
          ${[0, 1, 2].map((i) => `<input id="p-hood-${i}" value="${esc((c.farmAreas || [])[i] || "")}" placeholder="For example: Ghent" maxlength="60" style="margin-bottom:8px">`).join("")}
          <p class="small muted">The neighborhoods you work and sell in. They show on your public profile as your neighborhoods, proof that you post where you sell.</p>
        </div>
        <div class="field"><label>Brokerage or firm (optional)</label><input id="p-brokerage" value="${esc(c.brokerage || "")}" placeholder="Your brokerage, as licensed" maxlength="120"><p class="small muted">Shown on your public profile and proof sheet as "Brokered by", so your pages carry your firm the way your broker requires.</p></div>
      </div>
      <div class="field"><label>Your university (if you are a student now)</label><input id="p-university" value="${esc(c.university || u.university || "")}" placeholder="Start typing your school" maxlength="120"><div class="uni-results" id="p-university-results"></div><p class="small muted">Adding your school groups same-school referrals into your campus crew.${(c.university || u.university) && (c.universityStatus || u.universityStatus) === "current_student" ? ` Current badge: <strong>Campus: ${esc(c.university || u.university)}</strong>.` : ""}</p></div>
      <div class="field"><label>Student status (optional)</label>${universityStatusChipsHtml("p-university-status", c.universityStatus || u.universityStatus || "")}<p class="small muted">The campus badge is for current students only, so it shows while your status is Current student.</p></div>
      </div>
      <div class="fgroup">
      <p class="fg-kicker">Your links</p>
      <div class="form-2col">
        <div class="field"><label>TikTok handle</label><input id="p-tiktok" value="${esc(c.tiktokHandle || "")}" placeholder="Optional"></div>
        <div class="field"><label>YouTube channel</label><input id="p-youtube" value="${esc(c.youtubeChannel || "")}" placeholder="Optional"></div>
      </div>
      <div class="form-2col">
        <div class="field"><label>Facebook profile or Page</label><input id="p-facebook" value="${esc(c.facebookUrl || "")}" placeholder="Optional"></div>
        <div class="field"><label>X (Twitter) handle or URL</label><input id="p-x" value="${esc(c.xHandle || "")}" placeholder="Optional"></div>
      </div>
      <div class="field"><label>LinkedIn profile URL</label><input id="p-linkedin" value="${esc(c.linkedinUrl || "")}" placeholder="Optional"></div>
      </div>
      <div class="fgroup tint">
      <p class="fg-kicker">Your audience</p>
      <div class="field"><label>Your tier band</label><p style="margin:6px 0"><strong id="p-tier-band">${esc(c.tierBand || "")}</strong></p><p class="small muted">Set automatically from your total audience across platforms. It updates itself when your counts below change; nobody picks their own band.</p></div>
      <div class="field"><label>Your audience, platform by platform</label>
        <div class="form-2col">
          ${stackRows.map(([id, label, inputId]) => `<div class="field"><label>${label}</label><input type="number" id="${inputId}" min="0" value="${stackVal(id)}" oninput="syncStackTotal()"></div>`).join("")}
        </div>
        <p class="small muted">Total audience: <strong id="p-stack-total">${fmtNum(totalAudienceOf(c))}</strong> across every platform. Businesses see the total and the breakdown. Skip any platform you do not use (leave it at 0). Completing 3 or more platforms earns Momentum points.</p>
      </div>
      <div class="field"><label>Max visits per week</label>${dragBarHtml("p-maxvisits", 1, 7, `value="${c.maxVisitsPerWeek || 3}"`)}<p class="small muted">Your pace, your call: 1 to 7 comped visits a week. At your max, offers still arrive but accepting waits until next week, and businesses see you as booked up this week.</p></div>
      <div class="form-2col">
        <div class="field"><label>Typical post views</label><input type="number" id="p-avgviews" min="0" value="${c.avgViews || 0}"></div>
        <div class="field"><label>Your local reach (local audience share, %)</label><input type="number" id="p-localpct" min="0" max="100" value="${c.localAudiencePct === null || c.localAudiencePct === undefined ? "" : c.localAudiencePct}"><p class="small muted">${LOCAL_PCT_HELP}</p></div>
      </div>
      <div class="field"><label>Top audience cities</label><input id="p-topcities" value="${esc((c.topAudienceCities || []).join(", "))}" placeholder="Up to 5, comma separated"></div>
      </div>
      <div class="fgroup">
      <p class="fg-kicker">What you create</p>
      <div class="field"><label>What you create in</label><div class="checkrow">${cats}</div></div>
      <div class="field"><label>Comps you would accept</label><div class="checkrow">${comps}</div></div>
      <div class="field" id="p-paid-wrap" style="display:${c.tierBand === "Headliners" ? "" : "none"}">
        <label class="tgl-row"><input type="checkbox" class="sw" id="p-paid" ${c.openToPaidCampaigns ? "checked" : ""}><span><strong>Paid cash campaigns</strong> (Headliners tier): businesses can hire me for paid campaigns when a business runs one, on top of comps.</span></label>
      </div>
      <div class="showcase-block">
        <h4>How businesses can book you</h4>
        <p class="small muted">These save the moment you flip them — the same switches as your dashboard.</p>
        ${laneControlsHtml(c)}
      </div>
      <div class="field"><label>Best work (up to 3 links)</label>
        ${[0, 1, 2].map((i) => `<input id="p-work-${i}" type="url" placeholder="https://www.instagram.com/reel/... or a TikTok or YouTube link" value="${esc((c.bestWork || [])[i] || "")}" style="margin-bottom:8px">`).join("")}
        <p class="small muted">Your strongest posts, shown on your public profile and to businesses in search results as Watch cards. Instagram, TikTok, or YouTube links only. Clear a box to remove that link.</p>
      </div>
      <div class="field"><label>Bio</label><textarea id="p-bio" rows="2">${esc(c.bio || "")}</textarea></div>
      </div>
      <div id="save-warn"></div>
      <button class="btn" type="submit">Save profile</button> <span id="save-ok" class="saved"></span><span id="profile-complete-share"></span>
    </form>
    ${accountHtml(u)}
    <div id="my-showcase"></div>
  </div>`;
}

// The creator's own rating line on their Home/Profile: the second
// standing number next to Momentum. Rated: the average and who it
// came from. Unrated: the neutral explainer the spec asks for,
// never a zero and never penalty framing.
function myRatingHtml(card) {
  const count = card.ratingCount !== undefined ? card.ratingCount : (card.reviewSummary ? card.reviewSummary.count : 0);
  const avg = card.ratingAvg !== undefined && card.ratingAvg !== null ? card.ratingAvg : (card.reviewSummary ? card.reviewSummary.average : null);
  if (count >= 1 && avg !== null && avg !== undefined) {
    return `<div class="showcase-block"><h4>Your rating</h4><p style="margin:0">${starsHtml(avg)} <strong>${esc(String(avg))}</strong> from ${count} business${count === 1 ? "" : "es"}. Businesses see your rating next to your Momentum points: two separate numbers, and ratings never change your points.</p></div>`;
  }
  return `<div class="showcase-block"><h4>Your rating</h4><p class="muted" style="margin:0">Businesses rate you after visits. Your rating appears here after your first rated visit.</p></div>`;
}

function fillMyShowcase(card) {
  const sc = document.getElementById("my-showcase");
  if (sc && card) {
    sc.innerHTML = `${myRatingHtml(card)}<div class="showcase-block"><h4>How businesses see your profile</h4><p class="small muted">Your best work, SIGNL track record, and business reviews, exactly as they appear to businesses in search. On your public profile the rating shows once 3 or more businesses have rated you. The track record and reviews come only from real completed visits on SIGNL.</p>${creatorShowcaseHtml(card)}</div>`;
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

// ---------- un-completion guard (audit F9, 2026-10-22) ----------
// A profile save used to be able to take a complete profile
// offline in silence: clear the local audience %, uncheck every
// category, or zero every audience count, and the creator vanished
// from discovery under a cheerful "Saved." These pure helpers name
// what a save is about to do BEFORE anything is written; the
// warning renders inline and takes an explicit confirm, and after
// the confirm the save proceeds exactly as before (the guard
// warns, it never blocks, and the server truth is unchanged). Pure
// on purpose: the verify suite exercises them directly.
function uncompleteWarnings(wasComplete, vals) {
  if (!wasComplete) return [];
  const out = [];
  if (vals.localPctBlank) out.push("Saving without a local audience % takes your profile offline to businesses until it is back.");
  if (!vals.categoryCount) out.push("Saving with no content categories picked takes your profile offline to businesses until you pick at least one again.");
  if (!(vals.stackTotal > 0)) out.push("Saving with every audience count at zero takes your profile offline to businesses until you add your counts back.");
  return out;
}

// The full-signup twin (the audit's zero hole): an all-zero stack
// passes the form and lands an unbookable profile under a "profile
// is built" headline. Warn before the sign-up submits.
function zeroAudienceWarnings(stackTotal) {
  if (stackTotal > 0) return [];
  return ["Every audience count here is zero, so this profile will not be bookable until counts are added. You can sign up now and add your counts from your profile after approval, or go back and add them first."];
}

// The shared inline confirm: renders the warning lines into the
// mount with a proceed button and a Keep editing button, and
// resolves with the creator's choice. Nothing is written while
// it is open.
// In-app confirm sheet: the same promise shape as a native
// confirm(), rendered as DOM in a fixed overlay. Native confirm()
// is a silent gate: in contexts where the dialog never surfaces
// (suppressed modal dialogs), a confirm-first handler returns
// before doing anything and nothing can surface why (the Admin
// "Move to Tester" and My Offers "Close offer" buttons shipped
// dead that way, 2026-10-24). A DOM sheet always renders, always
// resolves, and works with touch, mouse, and keyboard alike.
function showConfirmSheet(heading, body, confirmLabel) {
  return new Promise((resolve) => {
    closeConfirmSheet();
    const el = document.createElement("div");
    el.id = "confirm-sheet";
    el.className = "sheet-overlay";
    el.innerHTML = `
    <div class="sheet" role="dialog" aria-label="${esc(heading)}">
      <strong>${esc(heading)}</strong>
      <p class="small muted">${esc(body)}</p>
      <button class="btn" style="width:100%" id="confirm-sheet-yes">${esc(confirmLabel || "Confirm")}</button>
      <button class="btn ghost" style="width:100%;margin-top:8px" id="confirm-sheet-no">Cancel</button>
    </div>`;
    document.body.appendChild(el);
    const done = (v) => { closeConfirmSheet(); resolve(v); };
    document.getElementById("confirm-sheet-yes").onclick = () => done(true);
    document.getElementById("confirm-sheet-no").onclick = () => done(false);
    el.addEventListener("click", (e) => { if (e.target === el) done(false); });
  });
}

function closeConfirmSheet() {
  const el = document.getElementById("confirm-sheet");
  if (el) el.remove();
  return false;
}

function confirmSaveWarning(mountId, heading, lines, confirmLabel) {
  return new Promise((resolve) => {
    const mount = document.getElementById(mountId);
    if (!mount) { resolve(true); return; }
    mount.innerHTML = `<div class="error-box" style="text-align:left"><strong>${esc(heading)}</strong><ul style="margin:8px 0;padding-left:18px">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><button type="button" class="btn small-btn danger" id="${mountId}-yes">${esc(confirmLabel)}</button> <button type="button" class="btn small-btn ghost" id="${mountId}-no">Keep editing</button></div>`;
    try { mount.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) { /* scroll is an enhancement */ }
    document.getElementById(mountId + "-yes").onclick = () => { mount.innerHTML = ""; resolve(true); };
    document.getElementById(mountId + "-no").onclick = () => { mount.innerHTML = ""; resolve(false); };
  });
}

async function doUpdateCreator(e) {
  e.preventDefault();
  const form = e.target;
  if (!submitBusy(form, true)) return false;
  const cats = Array.from(document.querySelectorAll("input[name=p-cat]:checked")).map((x) => x.value);
  const comps = Array.from(document.querySelectorAll("input[name=p-comp]:checked")).map((x) => x.value);
  const paidBox = document.getElementById("p-paid");
  if (suggestedTierId(profileStackTotal()) === "Headliners" && paidBox && paidBox.checked && !comps.includes(PAID_COMP)) comps.push(PAID_COMP);
  const pctRaw = document.getElementById("p-localpct").value;
  const wasProfileComplete = !!((state.user.profileCompletion && state.user.profileCompletion.complete) || (state.user.creator && state.user.creator.profileComplete === true));
  try {
    // Photos are NOT part of this save: the gallery control above
    // the form fields adds, removes and re-covers photos on its own
    // the moment they change (gallery fix, 2026-10-25).
    // Un-completion guard (audit F9): name the consequence BEFORE
    // the save lands and take an explicit confirm. After the
    // confirm, the save proceeds unchanged.
    const warnings = uncompleteWarnings(wasProfileComplete, { localPctBlank: pctRaw === "", categoryCount: cats.length, stackTotal: profileStackTotal() });
    if (warnings.length) {
      const proceed = await confirmSaveWarning("save-warn", "Before you save:", warnings, "Save anyway");
      if (!proceed) { submitBusy(form, false); return false; }
    }
    const cityEl = document.getElementById("p-city");
    const cityTextEl = document.getElementById("p-city-text");
    const data = await api("PATCH", "/me/profile", {
      name: document.getElementById("p-name").value,
      handle: normalizeHandleClient(document.getElementById("p-handle").value),
      primaryPlatform: document.getElementById("p-platform").value,
      city: cityEl ? cityEl.value : cityTextEl ? cityTextEl.value : undefined,
      neighborhood: document.getElementById("p-neighborhood").value,
      profession: document.getElementById("p-profession") ? document.getElementById("p-profession").value : undefined,
      farmAreas: [0, 1, 2].map((i) => { const el = document.getElementById("p-hood-" + i); return el ? el.value : ""; }),
      brokerage: document.getElementById("p-brokerage") ? document.getElementById("p-brokerage").value : undefined,
      university: document.getElementById("p-university").value,
      universityStatus: document.getElementById("p-university-status").value,
      state: document.getElementById("p-state-text") ? document.getElementById("p-state-text").value : undefined,
      country: document.getElementById("p-country-text") ? document.getElementById("p-country-text").value : undefined,
      tiktokHandle: normalizeHandleClient(document.getElementById("p-tiktok").value),
      youtubeChannel: document.getElementById("p-youtube").value,
      facebookUrl: document.getElementById("p-facebook").value,
      xHandle: document.getElementById("p-x").value,
      linkedinUrl: document.getElementById("p-linkedin").value,
      maxVisitsPerWeek: parseInt(document.getElementById("p-maxvisits").value, 10) || 3,
      // compOpen/paidRate are deliberately NOT sent here: the lane
      // control (laneControlsHtml) owns them and saves each flip on
      // its own, so this form save can never clobber lane state.
      followerCount: parseInt(document.getElementById("p-followers").value, 10) || 0,
      audienceStack: (() => {
        const s = { instagram: parseInt(document.getElementById("p-followers").value, 10) || 0 };
        for (const [id, platform] of [["p-stack-tiktok", "tiktok"], ["p-stack-facebook", "facebook"], ["p-stack-x", "x"], ["p-stack-linkedin", "linkedin"], ["p-stack-youtube", "youtube"], ["p-stack-snapchat", "snapchat"]]) {
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
    submitBusy(form, false);
    document.getElementById("save-ok").textContent = "Saved.";
    // The profile-completion moment: the save that flips the
    // profile to complete gets a one-tap share of the invite link.
    const nowComplete = !!((data.user.profileCompletion && data.user.profileCompletion.complete) || (data.user.creator && data.user.creator.profileComplete === true));
    if (!wasProfileComplete && nowComplete) {
      const shareEl = document.getElementById("profile-complete-share");
      if (shareEl) {
        const cplace = data.user.market === unlistedLabel() ? (data.user.city || "your city") : data.user.market;
        shareEl.innerHTML = `<p class="small" style="margin-top:10px"><strong>Your profile is complete and launch-ready.</strong> Tell another creator: ${shareBlockHtml(data.user.creator && data.user.creator.handle, cplace, "Share your invite")}</p>`;
      }
    }
    loadMyScore();
  } catch (err) {
    submitBusy(form, false);
    const errEl = document.getElementById("form-error");
    if (errEl) {
      errEl.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
      // The error renders at the top of a ~40-field form while the
      // user is looking at the Save button at the bottom: bring it
      // to them and focus it, so a failed save never looks like
      // nothing happened (UX audit fix, 2026-10-22).
      errEl.setAttribute("tabindex", "-1");
      try { errEl.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { errEl.scrollIntoView(); }
      try { errEl.focus({ preventScroll: true }); } catch (e) { /* focus is an enhancement */ }
    }
  }
  return false;
}

function crOffersSetSeg(seg) {
  state.crOffersSeg = seg;
  loadCreatorOffers();
  return false;
}
async function loadCreatorOffers() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  const u = state.user;
  // The completion gate replaces the deck until the four
  // basics are done (spec §6.2): a creator businesses cannot
  // find yet does not see offers.
  if (u.profileCompletion && !u.profileCompletion.complete) {
    el.innerHTML = `${wsHead("Offers", { sub: "Flip through offers near you. Apply to the ones you want.", subKey: "cr-offers" })}${gateCardHtml(u)}`;
    return;
  }
  try { localStorage.setItem("signl-offers-seen", String(Date.now())); } catch (e) { /* private mode */ }
  if (!state.crOffersSeg) state.crOffersSeg = "foryou";
  const seg = state.crOffersSeg;
  el.innerHTML = `
    ${wsHead("Offers", { sub: "Flip through offers near you. Apply to the ones you want.", subKey: "cr-offers" })}
    <div id="cr-offers-segs"></div>
    <div id="cr-seg-body">${skelHtml("Loading offers...", 2)}</div>`;
  let directCount = 0, appliedCount = 0;
  try {
    const [od, bd, ad] = await Promise.all([
      api("GET", "/offers").catch(() => ({ offers: [] })),
      api("GET", "/bookings").catch(() => ({ bookings: [] })),
      api("GET", "/applications").catch(() => ({ applications: [] })),
    ]);
    const bookedIds = new Set((bd.bookings || []).filter((b) => b.offerId && b.status !== "cancelled" && b.status !== "expired").map((b) => b.offerId));
    directCount = (od.offers || []).filter((o) => o.lane !== "open" && !bookedIds.has(o.id)).length;
    appliedCount = (ad.applications || []).filter((a) => a.status === "applied").length;
    state.waitCounts = state.waitCounts || {};
    state.waitCounts.crInvites = directCount;
  } catch (e) { /* counts are an enhancement */ }
  const segHost = document.getElementById("cr-offers-segs");
  if (!segHost) return;
  segHost.innerHTML = wsTabs([
    { label: "For you", on: seg === "foryou", onclick: "return crOffersSetSeg('foryou')" },
    { label: "Invited", count: directCount || null, on: seg === "invited", onclick: "return crOffersSetSeg('invited')" },
    { label: "Applied", count: appliedCount || null, on: seg === "applied", onclick: "return crOffersSetSeg('applied')" },
  ]);
  renderBottomNav();
  const body = document.getElementById("cr-seg-body");
  if (!body) return;
  if (seg === "foryou") {
    body.innerHTML = `<div id="open-board"></div>`;
    loadOpenBoard();
  } else if (seg === "applied") {
    body.innerHTML = `<div id="my-apps"></div><div id="creator-notes" class="mt"></div>`;
    loadMyApplications();
    loadNotificationsInto("creator-notes");
  } else {
    body.innerHTML = `<div id="direct-offers">${skelHtml("Loading your direct offers...", 1)}</div>`;
    loadDirectOffers();
  }
}

async function loadDirectOffers() {
  const direct = document.getElementById("direct-offers");
  if (!direct) return;
  try {
    const [data, bkData] = await Promise.all([
      api("GET", "/offers"),
      api("GET", "/bookings").catch(() => ({ bookings: [] })),
    ]);
    if (!document.getElementById("direct-offers")) return;
    // An offer the creator already booked out of this list reads
    // Booked (code in My Visits), never Accept/Decline again: the
    // server refuses a second accept, and declining a booked offer
    // is refused too, so the buttons could only ever error
    // (perfection pass, 2026-10-26).
    const bookedOfferIds = new Set((bkData.bookings || []).filter((b) => b.offerId && b.status !== "cancelled" && b.status !== "expired").map((b) => b.offerId));
    const mine = (data.offers || []).filter((o) => o.lane !== "open");
    if (!mine.length) {
      direct.innerHTML = `<div class="empty-state"><span class="es-badge"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg></span><h3>No invites yet</h3><p>When a business sends an offer straight to you, it lands here.</p></div>`;
      return;
    }
    direct.innerHTML = `<div class="vx-stagger">` + mine.map((o) => { const rights = o.visitRights || rightsForVisit(o.kind); const booked = bookedOfferIds.has(o.id); return `
      <div class="card mb slot-card">
        <div class="slot-top">
          ${bizChipHtml(o.businessName)}
          <div class="slot-body">
            <div class="slot-badges"><span class="badge tier">${esc(o.businessName)}</span></div>
            <div class="slot-name">${esc(o.title)}</div>
            <div class="slot-meta"><span>${o.bookedCount}/${o.spots} spots booked</span><span>${o.creatorId ? "Sent directly to you" : "Open to your market"}</span></div>
          </div>
        </div>
        <div class="slot-deal">
        ${dealRowsHtml(o)}
        ${o.kind === "paid" && o.paidBrief ? `<p class="small"><strong>Key points:</strong> ${esc(o.paidBrief)}</p>` : ""}
        ${dealPlainWordsHtml(o)}
        ${reviewLinksBlockHtml(o.businessReviewLinks)}
        ${referralProgramBlockHtml(o.businessReferralProgram)}
        <p class="small muted">${o.windowMode === "thisweek" ? "Redeem this week — ends Sunday" : "Redeem within 7 days of accepting"} &middot; no appointment needed.${o.visitWindow ? ` Note from the business: ${esc(o.visitWindow)}` : ""}</p>
        </div>
        <div class="slot-foot">
          <div><div class="slot-price">$${fmtPrice(o.kind === "paid" ? o.cashRate : o.dollarCap)}</div><div class="slot-note">${o.kind === "paid" ? "Rate" : "Comp cap"}</div></div>
          <div class="slot-actions">
            ${booked ? `<span class="badge ok">Booked</span>
            <button class="btn small-btn ghost" onclick="return go('dashboard','My Visits')">My Visits</button>` : `<form onsubmit="return acceptOffer(event, '${o.id}')">
              <button class="btn book" type="submit">Accept</button>
            </form>
            ${o.creatorId ? `<button class="btn small-btn danger" onclick="declineOffer('${o.id}')">Decline</button>` : ""}`}
            <button class="btn small-btn ghost" data-ctx="${esc(o.title)}" onclick="return openThreadCtx('${o.businessId}', this.dataset.ctx)">Message</button>
          </div>
        </div>
      </div>`; }).join("") + `</div>`;
  } catch (err) {
    direct.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}
// ---------- open offers board + my applications (offer flow v2) ----------
// Applying is ONE TAP. There is no pitch box anywhere: the
// application is the creator's profile card (local %, Impact,
// Momentum, track record, rate), attached automatically by the
// server. My Applications shows honest states, and every ending
// comes with a reason, never silence.
const RELEASE_TEXT = {
  spots_filled: "The business filled all the spots on this offer.",
  selection_deadline: "The selection deadline passed, so applications released automatically. Nobody should be left waiting without an answer.",
  offer_expired: "The offer's redemption window passed before selections finished.",
  offer_closed: "The business closed this offer.",
  business_released: "The business released this application to decide on the remaining stack.",
  backfill_window_passed: "The 24 hour backfill window passed, so the spot moved to the next applicant.",
  backfill_declined: "You passed on the backfill spot.",
  creator_declined: "You gave this spot back.",
};

async function loadOpenBoard() {
  const el = document.getElementById("open-board");
  if (!el) return;
  try {
    const data = await api("GET", "/open-offers");
    if (!document.getElementById("open-board")) return;
    if (!data.offers.length) {
      el.innerHTML = `<div class="empty-state"><span class="es-badge"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg></span><h3>Open offers in ${esc(marketTalkNameClient(state.user.market))}</h3><p>No new offers near you right now. New offers from businesses in ${esc(state.user.city || marketTalkNameClient(state.user.market))} show up here first.</p></div>`;
      return;
    }
    state.openOffers = data.offers;
    await ensureDeckState();
    el.innerHTML = `<h3>Open offers in ${esc(state.user.market)}</h3>
    <p class="small muted">One tap applies — your profile card is the application.</p>
    <div id="offers-toggle">${offersModeToggleHtml()}</div>
    <div id="open-list"></div>`;
    renderOpenBoard();
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// One offer card, two surfaces: the V4 color-blocked feed card
// renders unchanged in List mode and inside the stack in Cards
// mode — same rows, same buttons, same handlers. In preview mode
// (opts.preview) the same card renders with simulation actions:
// Apply posts to the preview endpoint (writes nothing) and there
// is no Message button (no real thread exists behind a preview).
function offerFeedCardHtml(o, opts) {
  const preview = !!(opts && opts.preview);
  const spotsLeft = Math.max(0, o.spots - (o.filledCount || 0));
  return `
      <div class="card mb feed-card slot-card">
        <div class="slot-top">
          ${bizChipHtml(o.businessName)}
          <div class="slot-body">
            <div class="slot-badges"><span class="badge tier">${esc(o.businessName)}</span>${o.fitNote ? `<span class="badge ok">${esc(o.fitNote)}</span>` : ""}</div>
            <div class="slot-name">${esc(o.title)}</div>
            <div class="slot-meta"><span>Redeem ${fmtDay(o.windowStartAt)} to ${fmtDay(o.windowEndAt)}</span><span>${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left</span>${o.businessNeighborhood ? `<span>${esc(o.businessNeighborhood)}</span>` : ""}</div>
          </div>
        </div>
        <div class="slot-deal">
        ${dealRowsHtml(o)}
        ${o.kind === "paid" && o.paidBrief ? `<p class="small"><strong>Key points:</strong> ${esc(o.paidBrief)}</p>` : ""}
        ${dealPlainWordsHtml(o)}
        ${reviewLinksBlockHtml(o.businessReviewLinks)}
        ${referralProgramBlockHtml(o.businessReferralProgram)}
        <p class="small muted">Apply by ${fmtDay(o.applicationsCloseAt)} &middot; ${o.applicationCount} applied${o.visitWindow ? `<br>Note from the business: ${esc(o.visitWindow)}` : ""}</p>
        ${o.businessAbout ? `<p class="small muted">${esc(o.businessAbout)}</p>` : ""}
        </div>
        <div class="slot-foot">
          <div><div class="slot-price">$${fmtPrice(o.kind === "paid" ? o.cashRate : o.dollarCap)}</div><div class="slot-note">${o.kind === "paid" ? "Rate" : "Comp value"}</div></div>
          <div class="slot-actions">
            ${o.myApplication
              ? (preview
                ? `<span><span class="badge info">Applied</span> <span class="small muted">Simulation: nothing was sent.</span></span>`
                : `<span><span class="badge info">Applied</span> <a href="#" onclick="document.getElementById('my-apps').scrollIntoView({behavior:'smooth'}); return false;">My Applications</a></span>`)
              : (preview
                ? `<button class="btn book" onclick="pvApplyToOffer('${o.id}')">Apply</button>`
                : `<button class="btn book" onclick="applyToOffer('${o.id}')">Apply</button>`)}
            ${preview ? "" : `<button class="btn small-btn ghost" data-ctx="${esc(o.title)}" onclick="return openThreadCtx('${o.businessId}', this.dataset.ctx)">Message</button>`}
          </div>
        </div>
        ${opts && opts.pileKey && !o.myApplication ? `<div class="offer-pile-row"><button type="button" class="btn small-btn ghost" onclick="cardLater('${opts.pileKey}','${o.id}')">Later</button><button type="button" class="btn small-btn ghost" onclick="cardHide('${opts.pileKey}','${o.id}')">Not for me</button></div>` : ""}
      </div>`;
}

// ---------- Later piles + not a fit (Jeff, 2026-10-26) ----------
// Passing a card means LATER now: the card parks in a per-user
// pile for that deck. Real decks persist server-side (GET/POST
// /deck-state) so the pile survives sessions; the preview twins
// keep theirs in memory and write nothing. When the unseen cards
// run out, the pile recycles as a Second look round in parked
// order; the end card arrives only after that round cycles too.
// The real no lives off the swipe: Not a fit / Not for me on the
// full profile or offer view and in the Later grid, with an undo
// toast and a Hidden restore list inside the Later view.
const DECKS = {
  offers: { pile: "offers", idOf: (o) => o.id, notFit: "Not for me", container: "open-list", board: () => renderOpenBoard() },
  discover: { pile: "discover", idOf: (c) => c.userId, notFit: "Not a fit", container: "discover-results", board: () => renderDiscoverResults() },
  pvoffers: { pile: "offers", preview: true, idOf: (o) => o.id, notFit: "Not for me", container: "pv-open-list", board: () => renderPvBoard() },
  pvdiscover: { pile: "discover", preview: true, idOf: (c) => c.userId, notFit: "Not a fit", container: "pv-discover-body", board: () => renderPvDiscoverBody() },
};
const pvPiles = { discover: { later: [], hidden: [], usedLater: false }, offers: { later: [], hidden: [], usedLater: false } };
function emptyPile() { return { later: [], hidden: [], usedLater: false }; }
function pileOf(key) {
  const meta = DECKS[key];
  if (!meta) return emptyPile();
  if (meta.preview) return pvPiles[meta.pile];
  if (!state.deckState) state.deckState = { discover: emptyPile(), offers: emptyPile() };
  return state.deckState[meta.pile] || emptyPile();
}
let deckStateLoaded = false;
async function ensureDeckState() {
  if (deckStateLoaded) return;
  deckStateLoaded = true;
  try {
    const data = await api("GET", "/deck-state");
    if (data && data.decks) state.deckState = { discover: { ...emptyPile(), ...(data.decks.discover || {}) }, offers: { ...emptyPile(), ...(data.decks.offers || {}) } };
  } catch (e) { /* a failed read leaves the decks working session-only */ }
}
function pilePersist(key, action, itemId) {
  const meta = DECKS[key];
  if (!meta || meta.preview) return;
  api("POST", "/deck-state", { deck: meta.pile, action, itemId }).catch(() => {});
}
function pileLater(key, itemId) {
  const pile = pileOf(key);
  if (!pile.later.includes(itemId)) pile.later.push(itemId);
  pile.hidden = pile.hidden.filter((x) => x !== itemId);
  pile.usedLater = true;
  pilePersist(key, "later", itemId);
  syncDeckChrome(key);
}
function pileUnlater(key, itemId) {
  const pile = pileOf(key);
  pile.later = pile.later.filter((x) => x !== itemId);
  pilePersist(key, "unlater", itemId);
  syncDeckChrome(key);
}
function pileHide(key, itemId) {
  const pile = pileOf(key);
  if (!pile.hidden.includes(itemId)) pile.hidden.push(itemId);
  pile.later = pile.later.filter((x) => x !== itemId);
  pilePersist(key, "hide", itemId);
  showToast("Hidden", () => { pileUnhide(key, itemId); refreshDeckAfterPile(key); });
  syncDeckChrome(key);
}
function pileUnhide(key, itemId) {
  const pile = pileOf(key);
  pile.hidden = pile.hidden.filter((x) => x !== itemId);
  pilePersist(key, "unhide", itemId);
  syncDeckChrome(key);
}
function refreshDeckAfterPile(key) {
  delete stackState[key];
  const meta = DECKS[key];
  if (meta) meta.board();
}
// One small toast, in-system: dark pill, one optional Undo.
let toastTimer = null;
let toastUndoFn = null;
function showToast(text, undoFn) {
  let t = document.getElementById("signl-toast");
  if (!t) { t = document.createElement("div"); t.id = "signl-toast"; t.className = "signl-toast"; document.body.appendChild(t); }
  toastUndoFn = undoFn || null;
  t.innerHTML = `<span>${esc(text)}</span>${undoFn ? `<button type="button" onclick="toastUndoRun()">Undo</button>` : ""}`;
  t.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); }, 4500);
}
function toastUndoRun() {
  const t = document.getElementById("signl-toast");
  if (t) t.classList.remove("show");
  if (toastTimer) clearTimeout(toastTimer);
  const fn = toastUndoFn;
  toastUndoFn = null;
  if (fn) fn();
  return false;
}
// Queue math for a deck: hidden items vanish, parked items wait
// for the Second look round, everything else is unseen.
function deckQueue(key, all) {
  const meta = DECKS[key];
  const pile = pileOf(key);
  const hidden = new Set(pile.hidden);
  const visible = (all || []).filter((it) => !hidden.has(meta.idOf(it)));
  const laterSet = new Set(pile.later);
  const unseen = visible.filter((it) => !laterSet.has(meta.idOf(it)));
  const parked = pile.later.map((id) => visible.find((it) => meta.idOf(it) === id)).filter(Boolean);
  return { visible, unseen, parked };
}
function deckSrcOf(key) {
  if (key === "offers") return state.openOffers || [];
  if (key === "discover") return state.discover || [];
  if (key === "pvoffers") return (state.preview && state.preview.offersList) || [];
  if (key === "pvdiscover") return (state.preview && state.preview.creators) || [];
  return [];
}
// Builds a deck's stackState: unseen first; if only the pile is
// left, the deck opens on the Second look round. When round 1
// runs out, onRoundEnd deals the pile back in, in parked order.
function startDeck(key, all, cfg) {
  const q = deckQueue(key, all);
  const round = q.unseen.length ? 1 : 2;
  return {
    items: round === 1 ? q.unseen : q.parked, idx: 0, passed: 0, src: all, round,
    onRoundEnd: (wrap) => {
      const s = stackState[key];
      if (!s || s.round !== 1) return false;
      const q2 = deckQueue(key, s.src);
      if (!q2.parked.length) return false;
      s.items = q2.parked;
      s.idx = 0;
      s.round = 2;
      renderStack(wrap);
      syncDeckChrome(key);
      return true;
    },
    ...cfg,
  };
}
function syncDeckChrome(key) {
  if (!DECKS[key]) return;
  const s = stackState[key];
  const q = deckQueue(key, s ? s.src : deckSrcOf(key));
  document.querySelectorAll(`[data-deckcounts="${key}"]`).forEach((el) => { el.textContent = `${q.unseen.length} new · ${q.parked.length} in Later`; });
  document.querySelectorAll(`[data-laterchip="${key}"]`).forEach((el) => { el.textContent = `Later (${q.parked.length})`; });
  document.querySelectorAll(`[data-deckteach="${key}"]`).forEach((el) => { el.style.display = pileOf(key).usedLater ? "none" : ""; });
}
function deckChromeHtml(key) {
  return `<span class="deck-counts" data-deckcounts="${key}"></span><button type="button" class="later-chip" data-laterchip="${key}" onclick="openLaterPile('${key}')">Later (0)</button>`;
}
function deckTeachHtml(key) {
  return `<p class="small muted deck-teach" data-deckteach="${key}">Swipe left to park in Later. Nothing is a no until you say so.</p>`;
}
// The Later view: the pile as a grid over the board container.
// Items render with the deck's own list cards (so invite/apply
// ride along), plus Back to deck and the not-fit action per item,
// and a Hidden restore list so nothing is unrecoverable.
function laterItemHtml(key, item) {
  const meta = DECKS[key];
  const id = meta.idOf(item);
  const card = key === "offers" ? offerFeedCardHtml(item)
    : key === "pvoffers" ? offerFeedCardHtml(item, { preview: true })
    : key === "discover" ? creatorCard(item, state.user)
    : creatorCard(item, state.user, { preview: true });
  const viewBtn = key === "discover" ? `<button type="button" class="btn small-btn ghost" onclick="openCreatorProfile('${id}')">View profile</button>`
    : key === "pvdiscover" ? `<button type="button" class="btn small-btn ghost" onclick="previewViewCreator('${id}')">View profile</button>` : "";
  return `<div class="later-item">${card}<div class="later-actions">${viewBtn}<button type="button" class="btn small-btn ghost" onclick="laterSendToDeck('${key}','${id}')">Back to deck</button><button type="button" class="btn small-btn ghost" onclick="laterHideItem('${key}','${id}')">${esc(meta.notFit)}</button></div></div>`;
}
function laterLabelOf(key, item) {
  if (key === "offers" || key === "pvoffers") return item.title || "Offer";
  const p = item.profile || {};
  return `${item.name || ""} @${p.handle || ""}`;
}
function openLaterPile(key) {
  const meta = DECKS[key];
  if (!meta) return false;
  const el = document.getElementById(meta.container);
  if (!el) return false;
  const all = deckSrcOf(key);
  const pile = pileOf(key);
  const q = deckQueue(key, all);
  const hiddenItems = pile.hidden.map((id) => (all || []).find((it) => meta.idOf(it) === id)).filter(Boolean);
  const gridCls = key === "offers" || key === "pvoffers" ? "vx-stagger" : "creator-grid";
  el.innerHTML = `<div class="later-head"><button type="button" class="btn small-btn ghost" onclick="laterBackToDeck('${key}')">&larr; Back to deck</button><h3 style="margin:0">Later (${q.parked.length})</h3></div>
    <p class="small muted">Parked cards, in the order you parked them. Open one to act on it, send it back to the deck, or mark it ${meta.notFit === "Not for me" ? "not for you" : "not a fit"}.</p>
    ${q.parked.length ? `<div class="${gridCls}">${q.parked.map((it) => laterItemHtml(key, it)).join("")}</div>` : `<div class="panel center"><p class="muted">Nothing parked yet. Swipe left on a card and it waits here.</p></div>`}
    ${hiddenItems.length ? `<div class="hidden-block"><h4>Hidden (${hiddenItems.length})</h4>${hiddenItems.map((it) => `<div class="hidden-row"><span>${esc(laterLabelOf(key, it))}</span><button type="button" class="btn small-btn ghost" onclick="laterRestoreItem('${key}','${meta.idOf(it)}')">Restore</button></div>`).join("")}</div>` : ""}`;
  const pos = document.querySelector(`[data-stackpos="${key}"]`);
  if (pos) pos.textContent = "";
  window.scrollTo(0, 0);
  return false;
}
function laterBackToDeck(key) { delete stackState[key]; DECKS[key].board(); return false; }
function laterSendToDeck(key, itemId) { pileUnlater(key, itemId); openLaterPile(key); return false; }
function laterHideItem(key, itemId) { pileHide(key, itemId); openLaterPile(key); return false; }
function laterRestoreItem(key, itemId) { pileUnhide(key, itemId); openLaterPile(key); return false; }
// The two off-swipe actions on full cards in list contexts.
function cardLater(key, itemId) { pileLater(key, itemId); showToast("Parked in Later"); refreshDeckAfterPile(key); return false; }
function cardHide(key, itemId) { pileHide(key, itemId); refreshDeckAfterPile(key); if (key === "offers" && !document.getElementById("open-list")) loadCreatorHome(); return false; }
function profileLater(userId, preview) { pileLater(preview ? "pvdiscover" : "discover", userId); showToast("Parked in Later"); return false; }
function profileNotFit(userId, preview) {
  pileHide(preview ? "pvdiscover" : "discover", userId);
  if (preview) previewBackToResults(); else backToDiscover();
  return false;
}

// ---------- V5: the Offers feed as a card stack (Jeff, 2026-10-25) ----------
// Same stack model as Discover. Apply runs the exact apply call
// (one tap, no added confirm — identical to the list button);
// a pass parks the offer in the creator's Later pile (see the
// Later system above), which persists server-side.
function offersModeToggleHtml() {
  const mode = state.offersMode || "cards";
  return `<div class="view-toggle"><div class="vt-group"><button type="button" class="rchip${mode === "cards" ? " on" : ""}" onclick="setOffersMode('cards')">Cards</button><button type="button" class="rchip${mode === "list" ? " on" : ""}" onclick="setOffersMode('list')">List</button></div>${deckChromeHtml("offers")}<span class="stack-pos" data-stackpos="offers"></span></div>${deckTeachHtml("offers")}`;
}
function setOffersMode(mode) {
  state.offersMode = mode;
  const tg = document.getElementById("offers-toggle");
  if (tg) tg.innerHTML = offersModeToggleHtml();
  renderOpenBoard();
  return false;
}
function renderOpenBoard() {
  const el = document.getElementById("open-list");
  if (!el) return;
  const all = state.openOffers || [];
  if ((state.offersMode || "cards") === "list") {
    const pos = document.querySelector('[data-stackpos="offers"]');
    if (pos) pos.textContent = "";
    const q = deckQueue("offers", all);
    el.innerHTML = `<div class="vx-stagger">${q.visible.map((o) => offerFeedCardHtml(o, { pileKey: "offers" })).join("")}</div>`;
    syncDeckChrome("offers");
    return;
  }
  if (!stackState.offers || stackState.offers.src !== all) {
    stackState.offers = startDeck("offers", all, {
      cardHtml: (o) => offerFeedCardHtml(o),
      goLabelFor: (o) => (o.myApplication ? "Applied" : "Apply"),
      onGo: async (o) => {
        if (o.myApplication) { stackAdvance("offers", "go"); return; }
        try {
          await api("POST", `/offers/${o.id}/apply`, {});
          o.myApplication = true;
          pileUnlater("offers", o.id);
          refreshBadges();
          stackAdvance("offers", "go");
          loadMyApplications();
        } catch (err) {
          alert(err.message);
          const wrap = document.querySelector('[data-stack="offers"]');
          if (wrap) renderStack(wrap);
        }
      },
      onPass: (o) => { pileLater("offers", o.id); },
      onTap: null,
      endHtml: (passed, total) => offersEndHtml(passed, total),
    });
  }
  el.innerHTML = `<div class="stk-wrap" data-stack="offers"></div>`;
  renderStack(el.firstElementChild);
  syncDeckChrome("offers");
}
function offersEndHtml(passed, total) {
  const q = deckQueue("offers", (stackState.offers && stackState.offers.src) || []);
  const n = q.parked.length;
  const seen = q.visible.length;
  return `<div class="stk-end"><h3>That's every open offer right now</h3><p class="small muted">You looked through ${seen} offer${seen === 1 ? "" : "s"}. New offers land here first, and your applications are tracked under My Applications below.</p><div class="stk-end-actions">${n ? `<button type="button" class="btn ghost" onclick="openLaterPile('offers')">Review Later (${n})</button>` : ""}<button type="button" class="btn" onclick="loadOpenBoard()">Refresh offers</button></div></div>`;
}

// ---------- creator-side preview: the open-offer deck ----------
// The same board, fed by simulated offers (GET
// /admin/preview/open-offers) so the creator deck can be
// test-driven end to end pre-launch. Apply posts to the preview
// endpoint, which validates and writes NOTHING.
function pvOffersHtml() {
  return `<section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> Open offers, as a creator sees them</h3>
    <p class="small muted">Simulated offers from preview businesses. Swipe or use the buttons; applying is a simulation.</p>
    <div id="pv-open-board">${skelHtml("Loading preview offers...", 2)}</div>
  </section>`;
}
async function loadPvOffers() {
  const pv = state.preview;
  if (!pv) return;
  try {
    const data = await api("GET", "/admin/preview/open-offers");
    pv.offersList = data.offers || [];
    renderPvBoardShell();
  } catch (err) {
    const el = document.getElementById("pv-open-board");
    if (el) el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}
function renderPvBoardShell() {
  const el = document.getElementById("pv-open-board");
  if (!el) return;
  el.innerHTML = `<div id="pv-offers-toggle">${pvOffersModeToggleHtml()}</div><div id="pv-open-list"></div>`;
  renderPvBoard();
}
function pvOffersModeToggleHtml() {
  const mode = state.pvOffersMode || "cards";
  return `<div class="view-toggle"><div class="vt-group"><button type="button" class="rchip${mode === "cards" ? " on" : ""}" onclick="setPvOffersMode('cards')">Cards</button><button type="button" class="rchip${mode === "list" ? " on" : ""}" onclick="setPvOffersMode('list')">List</button></div>${deckChromeHtml("pvoffers")}<span class="stack-pos" data-stackpos="pvoffers"></span></div>${deckTeachHtml("pvoffers")}`;
}
function setPvOffersMode(mode) {
  state.pvOffersMode = mode;
  const tg = document.getElementById("pv-offers-toggle");
  if (tg) tg.innerHTML = pvOffersModeToggleHtml();
  renderPvBoard();
  return false;
}
function renderPvBoard() {
  const el = document.getElementById("pv-open-list");
  if (!el || !state.preview) return;
  const all = state.preview.offersList || [];
  if ((state.pvOffersMode || "cards") === "list") {
    const pos = document.querySelector('[data-stackpos="pvoffers"]');
    if (pos) pos.textContent = "";
    const q = deckQueue("pvoffers", all);
    el.innerHTML = `<div class="vx-stagger">${q.visible.map((o) => offerFeedCardHtml(o, { preview: true, pileKey: "pvoffers" })).join("")}</div>`;
    syncDeckChrome("pvoffers");
    return;
  }
  if (!stackState.pvoffers || stackState.pvoffers.src !== all) {
    stackState.pvoffers = startDeck("pvoffers", all, {
      cardHtml: (o) => offerFeedCardHtml(o, { preview: true }),
      goLabelFor: (o) => (o.myApplication ? "Applied" : "Apply"),
      onGo: async (o) => {
        if (o.myApplication) { stackAdvance("pvoffers", "go"); return; }
        try {
          await pvApplyRequest(o);
          pileUnlater("pvoffers", o.id);
          stackAdvance("pvoffers", "go");
        } catch (err) {
          alert(err.message);
          const wrap = document.querySelector('[data-stack="pvoffers"]');
          if (wrap) renderStack(wrap);
        }
      },
      onPass: (o) => { pileLater("pvoffers", o.id); },
      onTap: null,
      endHtml: (passed, total) => pvOffersEndHtml(passed, total),
    });
  }
  el.innerHTML = `<div class="stk-wrap" data-stack="pvoffers"></div>`;
  renderStack(el.firstElementChild);
  syncDeckChrome("pvoffers");
}
async function pvApplyRequest(o) {
  await api("POST", "/admin/preview/apply", { offerId: o.id });
  o.myApplication = { status: "applied", preview: true };
}
async function pvApplyToOffer(offerId) {
  const pv = state.preview;
  const o = pv && (pv.offersList || []).find((x) => x.id === offerId);
  if (!o) return;
  try {
    await pvApplyRequest(o);
    pileUnlater("pvoffers", o.id);
    delete stackState.pvoffers;
    renderPvBoard();
  } catch (err) { alert(err.message); }
}
function pvOffersEndHtml(passed, total) {
  const q = deckQueue("pvoffers", (stackState.pvoffers && stackState.pvoffers.src) || []);
  const n = q.parked.length;
  const seen = q.visible.length;
  return `<div class="stk-end"><h3>That's every preview offer</h3><p class="small muted">You looked through ${seen} simulated offer${seen === 1 ? "" : "s"}. Nothing was applied for real: preview applications are never written.</p><div class="stk-end-actions">${n ? `<button type="button" class="btn ghost" onclick="openLaterPile('pvoffers')">Review Later (${n})</button>` : ""}<button type="button" class="btn" onclick="loadPvOffers()">Reload preview offers</button></div></div>`;
}

async function applyToOffer(offerId) {
  try {
    await api("POST", `/offers/${offerId}/apply`, {});
    pileUnlater("offers", offerId);
    delete stackState.offers;
    refreshBadges();
    loadOpenBoard();
    loadMyApplications();
  } catch (err) { alert(err.message); }
}

async function loadMyApplications() {
  const el = document.getElementById("my-apps");
  if (!el) return;
  try {
    const data = await api("GET", "/applications");
    if (!document.getElementById("my-apps")) return;
    const apps = data.applications || [];
    if (!apps.length) { el.innerHTML = ""; return; }
    const badge = (a) => ({
      applied: `<span class="badge info">Waiting on business</span>`,
      selected: `<span class="badge ok">Booked</span>`,
      released: `<span class="badge">Released</span>`,
      expired: `<span class="badge">Released</span>`,
      backfill_offered: `<span class="badge warn">Spot open &middot; 24h</span>`,
      backfill_accepted: `<span class="badge ok">Booked</span>`,
      withdrawn: `<span class="badge">Withdrawn</span>`,
    }[a.status] || esc(a.status));
    el.innerHTML = `<h3>My applications</h3>` + apps.map((a) => `
      <div class="card mb slot-card">
        <div class="slot-top">
          <div class="slot-body">
            <div class="slot-badges"><span class="badge tier">${esc(a.offer.businessName)}</span>${badge(a)}</div>
            <div class="slot-name">${esc(a.offer.title)}</div>
            <div class="slot-meta"><span>${esc(a.offer.businessName)}</span><span>${a.offer.kind === "paid" ? `Cash $${fmtPrice(a.offer.cashRate)}` : `Comp: ${esc(a.offer.whatComped)} (value $${fmtMoney(a.offer.dollarCap)})`}</span><span>applied ${fmtDate(a.appliedAt)}</span>${a.offer.windowStartAt ? `<span>redeem ${fmtDate(a.offer.windowStartAt)} to ${fmtDate(a.offer.windowEndAt)}</span>` : ""}</div>
          </div>
        </div>
        ${(a.status === "released" || a.status === "expired") && a.releaseReason ? `<p class="small">${esc(RELEASE_TEXT[a.releaseReason] || "This application ended.")}</p>` : ""}
        ${a.status === "selected" || a.status === "backfill_accepted" ? `<p class="small">Code + deadline in My Visits.</p>` : ""}
        <div class="slot-foot">
          <div><div class="slot-price">$${fmtPrice(a.offer.kind === "paid" ? a.offer.cashRate : a.offer.dollarCap)}</div><div class="slot-note">${a.offer.kind === "paid" ? "Rate" : "Comp value"}</div></div>
          <div class="slot-actions">
            ${a.status === "backfill_offered" ? `<button class="btn book" onclick="acceptBackfill('${a.id}')">Take the spot</button><button class="btn small-btn ghost" onclick="declineBackfill('${a.id}')">Pass</button>` : ""}
            ${a.status === "selected" ? `<button class="btn small-btn ghost" onclick="giveBackSpot('${a.id}')">Give the spot back</button>` : ""}
            ${a.status === "applied" ? `<button class="btn small-btn ghost" onclick="withdrawApplication('${a.id}')">Withdraw</button>` : ""}
          </div>
        </div>
      </div>`).join("");
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function acceptBackfill(applicationId) {
  try {
    const data = await api("POST", `/applications/${applicationId}/accept-backfill`, {});
    refreshBadges();
    state.tab = "My Visits";
    render();
    showBookingCard(data.booking, "Spot taken");
  } catch (err) { alert(err.message); loadMyApplications(); }
}

async function declineBackfill(applicationId) {
  try {
    await api("POST", `/applications/${applicationId}/decline-backfill`, {});
    loadMyApplications();
    loadOpenBoard();
  } catch (err) { alert(err.message); }
}

async function giveBackSpot(applicationId) {
  if (!confirm("Give this spot back? The booking cancels and the spot goes to the next applicant.")) return;
  try {
    await api("POST", `/applications/${applicationId}/decline`, {});
    loadMyApplications();
  } catch (err) { alert(err.message); }
}

async function withdrawApplication(applicationId) {
  try {
    await api("POST", `/applications/${applicationId}/withdraw`, {});
    loadMyApplications();
    loadOpenBoard();
  } catch (err) { alert(err.message); }
}

async function acceptOffer(e, offerId) {
  e.preventDefault();
  const form = e.target;
  if (!submitBusy(form, true)) return false;
  try {
    const data = await api("POST", `/offers/${offerId}/accept`, {});
    refreshBadges();
    state.tab = "My Visits";
    render();
    showBookingCard(data.booking, "You are booked");
  } catch (err) {
    submitBusy(form, false);
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

function visitsSetSeg(seg) {
  state.visitsSeg = seg;
  loadMyVisits(state.user && state.user.role === "business" ? "business" : "creator");
  return false;
}
function segEmptyLine(seg, role) {
  if (role === "business") {
    return {
      needs: "Nothing needs a time. When a visit lands without a date or window, it shows up here.",
      upcoming: "Nothing coming up. Booked visits with a date or window land here.",
      waiting: "Nothing waiting on a post. Redeemed visits land here until the post arrives.",
      done: "Nothing finished yet. Delivered visits land here.",
    }[seg] || "";
  }
  return {
    upcoming: "Nothing coming up. Booked visits land here.",
    needs: "Nothing needs your post. Redeemed visits land here until you add the post link.",
    done: "Nothing finished yet. Delivered visits land here.",
  }[seg] || "";
}
function visitsRowWrap(b, role, seg) {
  let top = "";
  if (role === "business" && seg === "waiting") {
    top = `<div class="visit-duebar"><span>${esc(postDueLine(b))}</span><button type="button" class="btn small-btn ws-outline" onclick="return sendNudge('${b.id}', this)">Send a nudge</button></div>`;
  }
  if (role === "creator" && seg === "needs") {
    top = `<div class="visit-duebar"><span>Deliverable: 1 post + 1 story that shares it. ${esc(postDueLine(b))}</span></div>`;
  }
  return `<div class="visit-wrap">${top}${visitCard(b, role)}</div>`;
}

async function loadMyVisits(role) {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/bookings");
    // License requests ride alongside the visits so each post
    // card can show its license state (fail-soft: cards simply
    // show no license state if this read ever fails).
    try { const lr = await api("GET", "/license-requests"); state.licenseRequests = lr.licenseRequests || []; } catch (e) { state.licenseRequests = state.licenseRequests || []; }
    if (role === "creator") {
      state.waitCounts = state.waitCounts || {};
      state.waitCounts.crLicense = (state.licenseRequests || []).filter((l) => l.status === "pending").length;
    }
    const flash = state.postFlash
      ? `<div class="card mb"><div class="success-hero">${successCheckHtml()}<h3>Post submitted</h3><p>Your post is in and the visit is marked delivered. Your numbers build from here: update them as the post grows and they feed your track record.</p></div></div>`
      : "";
    state.postFlash = false;
    const bookings = data.bookings || [];
    state.nudgeBookings = state.nudgeBookings || {};
    for (const b of bookings) state.nudgeBookings[b.id] = b;
    const segs = role === "business"
      ? [["needs", "Needs a time"], ["upcoming", "Upcoming"], ["waiting", "Waiting on post"], ["done", "Done"]]
      : [["upcoming", "Upcoming"], ["needs", "Needs your post"], ["done", "Done"]];
    const counts = {};
    for (const b of bookings) { const s = visitSegOf(b, role); counts[s] = (counts[s] || 0) + 1; }
    let seg = state.visitsSeg;
    if (!seg || !segs.some(([id]) => id === seg)) seg = segs[0][0];
    state.visitsSeg = seg;
    const rows = bookings.filter((b) => visitSegOf(b, role) === seg);
    const head = wsHead("Visits", { sub: role === "creator" ? "Your visits, and what each one needs from you." : "Who is coming in, and what each visit still needs.", subKey: role === "creator" ? "cr-visits" : "biz-visits" });
    let bizTop = "";
    if (role === "business") {
      let pinSet = null;
      try { const sd = await api("GET", "/me/staff"); pinSet = !!sd.staffPinSet; } catch (e) { /* the line simply stays off */ }
      bizTop = `<div class="counter-cta"><div><strong>At the register?</strong><p class="muted small" style="margin:4px 0 0">Open the counter to redeem a creator's code.</p></div><button type="button" class="btn ws-primary" onclick="return go('dashboard','Counter')">${bnIcon("keypad")} Counter</button></div>
      ${pinSet === false ? `<div class="notice" style="margin-top:12px"><strong>Staff PIN is not set.</strong> Your team redeems visits with it, never your login. <button class="btn small-btn" onclick="return go('dashboard','Settings')">Set staff PIN</button></div>` : ""}`;
    }
    const segTabs = wsTabs(segs.map(([id, label]) => ({ label, count: counts[id] || null, on: seg === id, onclick: `return visitsSetSeg('${id}')` })));
    let bodyHtml;
    if (!bookings.length) {
      bodyHtml = `<div class="empty-card"><div class="ec-t">No visits yet</div><div class="ec-s">${role === "creator" ? "When a business picks you, or you accept an invite, it lands here." : "When you select a creator or one accepts your invite, the visit lands here."}</div></div><p class="center">${role === "creator" ? `<button class="btn ws-primary" onclick="return go('dashboard','Offers')">See offers</button>` : `<button class="btn ws-primary" onclick="return go('dashboard','My Offers')">Post an offer</button>`}</p>`;
    } else if (!rows.length) {
      bodyHtml = `<div class="empty-card"><div class="ec-t">Nothing here</div><div class="ec-s">${esc(segEmptyLine(seg, role))}</div></div>`;
    } else {
      bodyHtml = `<div class="vx-stagger">${rows.map((b) => visitsRowWrap(b, role, seg)).join("")}</div>`;
    }
    el.innerHTML = flash + head + bizTop + segTabs + bodyHtml;
    if (state.visitFocus) {
      const target = document.getElementById("visit-" + state.visitFocus);
      state.visitFocus = null;
      if (target) setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    }
    if (role === "creator") startHomeCountdown();
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}
function postStateBadge(stateName, b) {
  switch (stateName) {
    case "submitted_on_time": return `<span class="badge ok">Post submitted on time</span>`;
    case "submitted_late": return `<span class="badge warn">Post submitted late</span>`;
    case "overdue": return `<span class="badge warn">Post late</span>`;
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
    case "overdue": return `<span class="badge warn">Post late</span>`;
    case "paused": return `<span class="badge bad">Creator paused: a post is past due</span>`;
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
  <div class="card visit-card mb" id="visit-${b.id}">
    <div class="flex-between"><strong>${esc(b.title)}</strong>${complianceBadge(b)}</div>
    <p class="small muted">${role === "creator" ? esc(b.businessName) : "@" + esc(b.creatorHandle) + " (" + esc(b.creatorName) + ")"} &middot; ${esc(marketDisplayName(b.market))} &middot; Comp: ${esc(b.whatComped)} (cap $${fmtMoney(b.dollarCap)})${b.kind === "paid" || b.paidLane ? "" : ` &middot; ${coversLine(b)}`} &middot; Visit: ${esc(b.visitDate || b.visitWindow || "Flexible")}</p>`;
  if (role === "creator" && b.redeemedAt && !post && b.postDeadline) {
    // Visual pass: the post countdown leads the card instead of
    // sitting under the honor form below the fold. Same ticking
    // element (home-tick), moved up; the proof form below keeps
    // its own deadline copy.
    const dueLate = b.compliance && (b.compliance.status === "overdue" || b.compliance.status === "paused" || b.compliance.status === "missed");
    html += `
    <div class="due-banner${dueLate ? " late" : ""}"><span class="db-lbl">${dueLate ? "Post late" : "Post due in"}</span><span class="db-num home-tick" data-mode="post" data-target="${esc(b.postDeadline)}">${esc(homeDurCore(Date.parse(b.postDeadline) - Date.now()))}</span></div>`;
  }
  if (b.paidBrief) {
    html += `<p class="small"><strong>Key points from the business:</strong> ${esc(b.paidBrief)}</p>`;
  }
  if (b.paidLane) {
    const lane = b.paidLane;
    const escrowBadge = lane.escrowState === "released"
      ? `<span class="badge ok">Payment released</span>`
      : lane.escrowState === "refunded"
        ? `<span class="badge warn">Payment refunded</span>`
        : `<span class="badge info">Payment held by SIGNL</span>`;
    html += role === "creator"
      ? `<p class="small"><span class="badge tier">Paid visit</span> Your rate $${fmtPrice(lane.rate)}: you receive $${fmtMoney(lane.creatorNet)} (97% of your rate). ${escrowBadge}<br><span class="muted">${esc(lane.paymentNote)}${lane.escrowState === "held" && lane.proofAt ? " Your post is in; the escrow releases 48 hours after proof." : ""}${lane.escrowState === "refunded" ? " This visit resolved without delivery, so the business was refunded." : ""} This booking includes the standard license: the business may repost your post and run it as an ad for 90 days from the post date, never longer, and never edited.</span>${fundsStatusHtml(lane, "creator")}</p>`
      : `<p class="small"><span class="badge tier">Paid visit</span> Creator rate $${fmtPrice(lane.rate)} &middot; you pay $${fmtMoney(lane.businessTotal)} (rate + 3%) &middot; the creator receives $${fmtMoney(lane.creatorNet)}. ${escrowBadge}<br><span class="muted">${esc(lane.paymentNote)} This booking includes the standard license: repost and ad use for 90 days from the post date.</span>${fundsStatusHtml(lane, "business")}</p>`;
  }
  if (role === "creator") html += referralProgramBlockHtml(b.businessReferralProgram);
  if (role === "business" && b.businessReferralProgram) {
    html += `<p class="small muted">Your referral program rides on this visit: creators see your ${b.businessReferralProgram.url ? "referral link" : "referral code"}${b.businessReferralProgram.note ? " and your note" : ""} on their visit card, so the bookings their posts send you land in your own program.</p>`;
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
      <button class="btn small-btn danger" type="submit">Report problem</button>
      <p class="small muted">The business didn't honor this comp. Filing this voids the visit: no post is owed, the compliance clock stops, and it cannot hurt your standing. It flags the business for the SIGNL team. It is never shown publicly.</p>
    </form>`;
  }
  if (role === "business" && b.codeStatus === "issued") {
    html += `<p class="small">Booking code <strong>${esc(b.code)}</strong>. Redeem it at the Counter tab when the creator is with you${b.checkinAt ? ", or confirm the visit below (creator checked in " + fmtDate(b.checkinAt) + ")" : ", or confirm the visit below if the code cannot be scanned"}.</p>
    <button class="btn small-btn" onclick="confirmVisit('${b.id}')">Confirm visit</button> <span class="small muted">Starts the 48-hour post clock.</span>`;
  }
  if (b.redeemedAt) {
    html += `<p class="small muted">Redeemed ${fmtDate(b.redeemedAt)} (${b.redeemMethod === "business_confirm" ? "business confirmed" : "code at counter"}). Post deadline: <strong>${fmtDate(b.postDeadline)}</strong>.</p>`;
  }
  if (role === "creator" && b.redeemedAt && !post) {
    const late = b.compliance && (b.compliance.status === "overdue" || b.compliance.status === "paused" || b.compliance.status === "missed");
    html += `
    <form onsubmit="return submitPost(event, '${b.id}')">
      <h4 style="margin:10px 0 4px">Post your proof</h4>
      ${late ? `<p class="small"><strong>This post is past its 48 hour deadline.</strong> Post within 48 hours for full credit. A late post inside the catch-up window still counts, and the missed deadline stays on your record. No link, no check-off.</p>` : `<p class="small muted">Your check-off is the post link itself. Paste it here and the visit is marked delivered${b.compliance && b.compliance.deadline ? ` (deadline ${esc(fmtDate(b.compliance.deadline))})` : ""}. Post within 48 hours for full credit. A late post inside the catch-up window still counts.</p>`}
      <div class="field"><label>Link to your Instagram post or reel</label><input id="post-url-${b.id}" type="url" placeholder="https://www.instagram.com/p/..." required></div>
      <label class="ckrow"><input type="checkbox" class="ckbox" id="post-disc-${b.id}"><span>My post clearly discloses the comp (for example #ad or "comped by the business"), as the FTC requires.</span></label>
      <p class="small muted">Post your honest experience. Nobody can require a positive post.</p>
      <button class="btn small-btn" type="submit">Submit post</button>
    </form>`;
  }
  if (role === "business" && b.compliance && b.compliance.status === "missed") {
    html += `<p class="small">This visit's comp was redeemed and no post was ever delivered. The creator's account has been closed to future offers. ${b.replacementRequestedAt ? "" : "You can request a replacement visit below."}</p>`;
  }
  if (post) {
    html += `<p class="small">Post: <a href="${esc(post.url)}" target="_blank" rel="noopener">${esc(post.url)}</a> &middot; submitted ${fmtDate(post.submittedAt)} (${post.hoursAfterRedeem}h after redemption) ${post.verifiedAt ? "&middot; <span class='saved'>Verified by the business</span>" : ""}</p>`;
    const lic = post.license && post.license.status === "granted" ? post.license : null;
    const licActive = !!lic && Date.parse(lic.windowEndsAt) > Date.now();
    const licReq = (state.licenseRequests || []).filter((l) => l.postId === post.id).slice().sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0] || null;
    if (post.adUseDeclaredAt) {
      html += `<p class="small"><span class="badge ok">Running as an ad</span> Declared ${fmtDate(post.adUseDeclaredAt)}. The creator was notified and earned +25 Momentum.${role === "business" && post.adUseWindowEndsAt ? ` ${b.kind === "paid" ? "This paid visit's" : "This license's"} ad window runs to ${fmtDate(post.adUseWindowEndsAt)}.` : ""}</p>`;
    } else if (role === "business") {
      if (b.kind === "paid") {
        html += `<button class="btn small-btn ghost" onclick="declareAdUse('${post.id}', 'paid')">Use in an ad</button> <span class="small muted">This was a paid visit: the standard license is included, repost and ad use for 90 days from the post date. The creator is notified and earns +25 Momentum.</span>`;
      } else if (licActive) {
        html += `<p class="small"><span class="badge ok">Licensed for ads</span> Through ${fmtDate(lic.windowEndsAt)}: repost and ad use covered.</p><button class="btn small-btn ghost" onclick="declareAdUse('${post.id}', 'license')">Use in an ad</button> <span class="small muted">The creator is notified and earns +25 Momentum.</span>`;
      } else if (licReq && licReq.status === "pending") {
        html += `<p class="small muted">License requested at $${fmtPrice(licReq.fee)}: waiting on the creator. You pay only if they approve, and the 90 days run from their yes.</p>`;
      } else if (b.creatorLicensingFee) {
        html += `<button class="btn small-btn ghost" onclick="requestLicense('${post.id}', ${b.creatorLicensingFee})">License for ads</button> <span class="small muted">This was a comp visit, so it covers native sharing only until licensed. The creator licenses this post for 90 days of repost and ad use at their $${fmtPrice(b.creatorLicensingFee)} fee, only with their approval.</span>${growthNudgeHtml()}`;
      } else {
        html += `<p class="small muted">This was a comp visit, so it covers native sharing only, with the creator tagged. This creator has not listed a licensing fee, so ad use is not available on this post.</p>`;
      }
    }
    if (role === "creator" && b.kind !== "paid") {
      if (licReq && licReq.status === "pending") {
        html += `<div class="notice blue"><strong>License request:</strong> ${esc(licReq.businessName || "A business")} wants to license this post for 90 days of reposting and ad use at your $${fmtPrice(licReq.fee)} fee. You keep $${fmtMoney(licReq.creatorNet)} (97%).<br><button class="btn small-btn" style="margin-top:8px" onclick="respondLicense('${licReq.id}', 'approve')">Approve license</button> <button class="btn small-btn ghost" style="margin-top:8px" onclick="respondLicense('${licReq.id}', 'decline')">Decline</button></div>`;
      } else if (licActive) {
        html += `<p class="small"><span class="badge ok">Licensed for ads</span> Through ${fmtDate(lic.windowEndsAt)}${licReq && licReq.creatorNet ? ` &middot; you kept $${fmtMoney(licReq.creatorNet)}` : ""}.</p>`;
      } else if (licReq && licReq.status === "declined") {
        html += `<p class="small muted">You declined a license request on this post. It stays native sharing only.</p>`;
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
      if (role === "business" && post.performance && post.performance.updatedAt) {
        html += `<p class="small muted">${perfSourceLabel(post.performance.source)}, updated ${fmtDay(post.performance.updatedAt)}${typeof post.performance.viewsGrowthPct === "number" ? ` &middot; views ${post.performance.viewsGrowthPct >= 0 ? "+" : ""}${post.performance.viewsGrowthPct}% since the first report` : ""}</p>`;
      }
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
      <button class="btn small-btn" type="submit">Report numbers</button> <span class="small muted">+5 Momentum</span>
    </form>`;
    }
  }
  if (post && role === "creator" && perfUpdateDue(post)) {
    html += perfUpdateFormHtml(b, "visits");
  }
  if (post && b.roas && (b.redemptions || post.reportedAt)) {
    const r = b.roas;
    const scoreLine = `<strong>SIGNL ROAS Score: ${r.score === null ? "n/a yet" : r.score.toFixed(2) + "&times;"}</strong> <span class="muted">(our own model)</span> &middot; $${fmtMoney(r.registerValue)} tracked through the code + $${fmtMoney(r.mediaValue)} modeled media value, against $${fmtMoney(r.compCost)} comp at cost + $${fmtMoney(r.discountCost)} code discounts${r.allInScore !== null && r.allInScore !== undefined ? ` &middot; all-in ${r.allInScore.toFixed(2)}&times; with the plan counted` : ""}`;
    html += role === "business"
      ? `<p class="small">${scoreLine}.</p>`
      : `<p class="small">${b.redemptions ? `Your code brought <strong>${b.redemptions.count} customer${b.redemptions.count === 1 ? "" : "s"}, $${fmtMoney(b.redemptions.basketTotal)} rung up</strong> at ${esc(b.businessName)}. ` : ""}${scoreLine}.</p>`;
  }
  if (role === "business" && post) {
    const ticket = state.user && state.user.business ? Number(state.user.business.averageTicket) || 0 : 0;
    const uses = Number(b.codeUseCount) || 0;
    const tallyCount = b.redemptions ? b.redemptions.count : uses;
    const tallyBasket = b.redemptions ? b.redemptions.basketTotal : (uses && ticket ? Math.round(uses * ticket * 100) / 100 : "");
    html += `
    ${!b.redemptions && uses > 0 ? (ticket
      ? `<p class="small" style="margin-top:12px">So far: ${uses} code use${uses === 1 ? "" : "s"} logged. At your $${fmtMoney(ticket)} average ticket that is about $${fmtMoney(uses * ticket)} of register value, estimated until you save this tally.</p>`
      : `<p class="small" style="margin-top:12px">So far: ${uses} code use${uses === 1 ? "" : "s"} logged. Set your average ticket under Plan and SIGNL estimates the register value until you save this tally.</p>`) : ""}
    <p style="margin-top:8px"><button class="btn small-btn ghost" type="button" onclick="logCodeUse('${b.id}')">Log a code use</button> <span class="small muted">${uses} logged so far at the counter</span></p>
    <form onsubmit="return submitCodeRedemptions(event, '${b.id}')">
      <h4 style="margin:10px 0 4px">Code tally for this visit</h4>
      <p class="small muted">One question settles it: how many customers used ${b.creatorCode ? `<strong>${esc(b.creatorCode)}</strong>` : "the creator's audience code"} at your register. Saving replaces the last tally and completes this visit's SIGNL ROAS Score.</p>
      <div class="form-2col">
        <div class="field"><label>How many customers used the code?</label><input type="number" id="redeem-count-${b.id}" min="0" placeholder="0" value="${tallyCount}" oninput="tallyCountChanged('${b.id}')"></div>
        <div class="field"><label>Total rung up with the code ($)</label><input type="number" id="redeem-basket-${b.id}" min="0" step="0.01" placeholder="0.00" value="${tallyBasket}" oninput="this.dataset.touched='1'"></div>
      </div>
      <button class="btn small-btn" type="submit">Save tally</button>
      ${b.redemptions ? `<span class="small muted">Last reported ${fmtDate(b.redemptions.reportedAt)}.</span>` : ""}
      <details style="margin-top:10px">
        <summary class="small">Adjust the details (optional)</summary>
        <div class="form-2col" style="margin-top:8px">
          <div class="field"><label>Discount percent given with the code</label><input type="number" id="redeem-disc-${b.id}" min="0" max="100" step="0.5" placeholder="As rung up" value="${b.redemptions && b.redemptions.discountPct ? b.redemptions.discountPct : ""}"></div>
          <div class="field"><label>What the comp cost you ($)</label><input type="number" id="redeem-cost-${b.id}" min="0" step="0.01" placeholder="At your cost" value="${typeof b.compCostActual === "number" ? b.compCostActual : ""}"></div>
        </div>
      </details>
    </form>`;
  }
  if (role === "business" && b.postState === "overdue" && !b.replacementRequestedAt && b.compliance && b.compliance.pauseAt && Date.now() >= Date.parse(b.compliance.pauseAt)) {
    // The Visit Guarantee replacement opens at the week, not at
    // 48 hours (Jeff's reframe, 2026-10-26): inside the week the
    // post is late, not failed, and still counts when it lands.
    html += `<button class="btn small-btn danger" onclick="requestReplacement('${b.id}')">Request replacement</button>`;
  }
  if (b.replacementRequestedAt) html += `<p class="small">Replacement requested ${fmtDate(b.replacementRequestedAt)}. SIGNL will line up a substitute creator.</p>`;
  if (role === "creator" && b.status === "completed") {
    if (b.creatorReview) {
      html += `<div class="review-item"><span class="small muted">${esc(b.businessName)} rated you</span><br>${starsHtml(b.creatorReview.stars)} <span class="small">${esc(b.creatorReview.comment || "")}</span></div>`;
    }
    if (b.businessReview) {
      html += `<div class="review-item"><span class="small muted">Your review of ${esc(b.businessName)}</span><br>${starsHtml(b.businessReview.stars)} <span class="small">${esc(b.businessReview.text || "")}</span> <span class="saved">+10 Momentum earned</span></div>`;
    } else {
      html += `
    <form onsubmit="return submitBusinessReview(event, '${b.id}')">
      <h4 style="margin:10px 0 4px">Review this business</h4>
      <p class="small muted">Optional, and honest is the whole point: leaving a review earns +10 Momentum at any star rating. SIGNL never pays for positive reviews, and nobody can ask you for one.</p>
      <div class="form-2col">
        <div class="field"><label>Your rating</label>${chipSelectHtml("bizrev-stars-" + b.id, [{ value: "5", label: "5 stars" }, { value: "4", label: "4 stars" }, { value: "3", label: "3 stars" }, { value: "2", label: "2 stars" }, { value: "1", label: "1 star" }], "5", null, false)}</div>
        <div class="field"><label>Your words (optional)</label><input id="bizrev-text-${b.id}" maxlength="500" placeholder="How was the visit, honestly?"></div>
      </div>
      <button class="btn small-btn" type="submit">Leave review</button> <span class="small muted">+10 Momentum</span>
    </form>`;
    }
    html += reviewLinksBlockHtml(b.businessReviewLinks);
  }
  if (role === "business" && b.status === "completed") {
    if (b.creatorReview) {
      html += `<div class="review-item"><span class="small muted">Your rating of this creator</span><br>${starsHtml(b.creatorReview.stars)} <span class="small">${esc(b.creatorReview.comment || "")}</span></div>`;
    } else {
      html += `
    <form onsubmit="return submitCreatorReview(event, '${b.id}')">
      <h4 style="margin:10px 0 4px">Rate this creator</h4>
      <p class="small muted">The visit is complete and the post is in. Rate how the visit and the post went. The rating shows on the creator's profile next to their Momentum points: two separate numbers, and ratings never change anyone's points. One rating per visit, and it cannot be edited after.</p>
      <div class="form-2col">
        <div class="field"><label>Your rating</label>${chipSelectHtml("crev-stars-" + b.id, [{ value: "5", label: "5 stars" }, { value: "4", label: "4 stars" }, { value: "3", label: "3 stars" }, { value: "2", label: "2 stars" }, { value: "1", label: "1 star" }], "5", null, false)}</div>
        <div class="field"><label>Your words (optional, 280 characters)</label><input id="crev-comment-${b.id}" maxlength="280" placeholder="How was the visit and the post?"></div>
      </div>
      <button class="btn small-btn" type="submit">Leave rating</button>
    </form>`;
    }
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
  if (!confirm("Request a replacement visit? The week has passed with no post, so the Visit Guarantee applies.")) return;
  try { await api("POST", `/bookings/${bookingId}/replacement`, {}); loadMyVisits("business"); }
  catch (err) { alert(err.message); }
}

async function submitPost(e, bookingId) {
  e.preventDefault();
  const disc = document.getElementById("post-disc-" + bookingId);
  if (!disc.checked) { alert("Confirm the disclosure first. Every SIGNL post must disclose the comp."); return false; }
  try {
    await api("POST", "/posts", { bookingId, url: document.getElementById("post-url-" + bookingId).value, includesDisclosure: true });
    state.postFlash = true;
    loadMyVisits("creator");
  } catch (err) { alert(err.message); }
  return false;
}

async function verifyPost(postId) {
  try { await api("POST", `/posts/${postId}/verify`, {}); loadMyVisits("business"); }
  catch (err) { alert(err.message); }
}

// Update-numbers ask (spec section 3): a post 7+ days old whose
// numbers were never reported, or not refreshed in 5+ days, gets
// an update card. Reporting is repeatable now: each save appends a
// snapshot and the growth line compares latest to first.
function perfUpdateDue(post) {
  if (!post) return false;
  const perf = post.performance || {};
  const base = perf.firstAt || post.submittedAt || post.createdAt;
  if (!base || Number.isNaN(Date.parse(base))) return false;
  if ((Date.now() - Date.parse(base)) / 86400000 < 7) return false;
  if (!perf.reported || !(perf.snapshots > 0)) return true;
  if (!perf.updatedAt) return true;
  return (Date.now() - Date.parse(perf.updatedAt)) / 86400000 >= 5;
}

function perfUpdateFormHtml(b, ctx) {
  const perf = (b.post && b.post.performance) || {};
  const growth = typeof perf.viewsGrowthPct === "number" && perf.views !== null && perf.views !== undefined
    ? `<p class="small"><strong>${fmtNum(perf.views)} views, ${perf.viewsGrowthPct >= 0 ? "+" : ""}${perf.viewsGrowthPct}% since your first report.</strong></p>`
    : "";
  const num = (v) => (v === null || v === undefined ? "" : v);
  return `
  <div class="card mb perf-update-card">
    <form onsubmit="return submitPostPerformanceUpdate(event, '${b.id}', '${ctx}')">
      <h4 style="margin:4px 0">Update post numbers</h4>
      <p class="small muted">${esc(b.title)} at ${esc(b.businessName)}: posts keep growing after week one. Fresh numbers keep the business's SIGNL ROAS Score honest, and updating earns +5 Momentum.</p>
      ${growth}
      <div class="form-2col">
        <div class="field"><label>Views</label><input type="number" id="perfu-views-${b.id}" min="0" value="${num(perf.views)}"></div>
        <div class="field"><label>Likes</label><input type="number" id="perfu-likes-${b.id}" min="0" value="${num(perf.likes)}"></div>
        <div class="field"><label>Comments</label><input type="number" id="perfu-comments-${b.id}" min="0" value="${num(perf.comments)}"></div>
        <div class="field"><label>Shares</label><input type="number" id="perfu-shares-${b.id}" min="0" value="${num(perf.shares)}"></div>
      </div>
      <button class="btn small-btn" type="submit">Save updated numbers</button>
    </form>
  </div>`;
}

async function submitPostPerformanceUpdate(e, bookingId, ctx) {
  e.preventDefault();
  try {
    const val = (k) => { const el = document.getElementById(`perfu-${k}-${bookingId}`); return !el || el.value === "" ? null : parseInt(el.value, 10); };
    await api("POST", `/bookings/${bookingId}/performance`, { views: val("views"), likes: val("likes"), comments: val("comments"), shares: val("shares") });
    if (ctx === "home") loadCreatorHome(); else loadMyVisits("creator");
  } catch (err) { alert(err.message); }
  return false;
}

// The counter-side code-use logger on the booking card: one tap
// per customer who uses the code, feeding the estimate until the
// owner saves the real tally.
async function logCodeUse(bookingId) {
  try {
    await api("POST", `/bookings/${bookingId}/code-uses`, { count: 1 });
    loadMyVisits("business");
  } catch (err) { alert(err.message); }
}

// While the owner types the tally count, the total follows count x
// average ticket until they hand-edit the total itself.
function tallyCountChanged(bookingId) {
  const basketEl = document.getElementById("redeem-basket-" + bookingId);
  const countEl = document.getElementById("redeem-count-" + bookingId);
  if (!basketEl || !countEl || basketEl.dataset.touched === "1") return;
  const ticket = state.user && state.user.business ? Number(state.user.business.averageTicket) || 0 : 0;
  const count = parseInt(countEl.value, 10) || 0;
  if (ticket > 0) basketEl.value = count ? String(Math.round(count * ticket * 100) / 100) : "";
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
    const discEl = document.getElementById("redeem-disc-" + bookingId);
    await api("POST", `/bookings/${bookingId}/code-redemptions`, {
      count: count === "" ? 0 : parseInt(count, 10),
      basketTotal: basket === "" ? 0 : parseFloat(basket),
      compCostActual: cost === "" ? null : parseFloat(cost),
      ...(discEl && discEl.value !== "" ? { discountPct: parseFloat(discEl.value) } : {}),
    });
    loadMyVisits("business");
  } catch (err) { alert(err.message); }
  return false;
}

// The Growth nudge (Jeff, 2026-10-26): shown to Self-Service
// businesses at the moment they start paid work or reuse. A muted
// caption under the action, never a gate: paid bookings and
// licensing are open on every plan.
function growthNudgeHtml() {
  const u = state.user;
  if (!u || u.role !== "business" || !u.business || u.business.plan !== "self-service") return "";
  return `<p class="small muted">Growth is built for paid work and reuse: every license and renewal tracked in one library, and priority access to the creators you license.</p>`;
}

async function declareAdUse(postId, basis) {
  const msg = basis === "license"
    ? "Use this post in an ad? Your license on this post covers repost and ad use inside its 90-day window. The creator is notified and earns +25 Momentum."
    : "Use this post in an ad? This paid visit includes the standard license: repost and ad use for 90 days from the post date. The creator is notified and earns +25 Momentum.";
  if (!confirm(msg)) return;
  try { await api("POST", `/posts/${postId}/ad-use`, {}); loadMyVisits("business"); }
  catch (err) { alert(err.message); }
}

async function requestLicense(postId, fee) {
  const total = Math.round(fee * 1.03 * 100) / 100;
  const net = Math.round(fee * 0.97 * 100) / 100;
  if (!confirm(`License this post for ads? The creator's fee is $${fmtPrice(fee)}: you pay $${fmtMoney(total)} (fee + 3%), the creator keeps $${fmtMoney(net)} (97%), held until they decide. If they approve, you can repost the post and run it as an ad for 90 days from their yes. Nothing is licensed unless they approve.`)) return;
  try { await api("POST", `/posts/${postId}/license-request`, {}); if (state.tab === "Content") renderContentTab(); else loadMyVisits("business"); }
  catch (err) { alert(err.message); }
}

async function respondLicense(id, decision) {
  const rec = (state.licenseRequests || []).find((l) => l.id === id);
  if (decision === "approve" && rec && !confirm(`Approve this license? ${rec.businessName || "The business"} can repost this post and run it as an ad for 90 days. You keep $${fmtMoney(rec.creatorNet)} (97% of your fee).`)) return;
  try { await api("POST", `/license-requests/${id}/respond`, { decision }); if (state.tab === "Earnings") renderEarningsTab(); else loadMyVisits("creator"); }
  catch (err) { alert(err.message); }
}

// ---------- business ----------

const BUSINESS_TABS = ["Home", "Requests", "Discover", "Favorites", "My Offers", "Counter", "Visits & Posts", "Content", "Analytics", "Plan", "Messages", "Profile", "More", "Settings", "Help"];

function renderBusinessDash() {
  const u = state.user;
  let tab = state.tab || "Home";
  if (!BUSINESS_TABS.includes(tab)) tab = "Home";
  // A "Send offer" from Discover lands on the composer, as before.
  if (state.offerTarget) tab = "My Offers";
  // V3: Requests is the Applicants segment of Offers (§5.2).
  if (tab === "Requests") { state.offersSeg = "applicants"; tab = "My Offers"; }
  state.tab = tab;
  app.innerHTML = `<div class="wrap"><div id="tab-body"></div></div>`;
  if (tab === "Home") loadBusinessHome();
  if (tab === "Discover") loadDiscover();
  if (tab === "Favorites") loadFavorites();
  if (tab === "My Offers") loadMyOffers();
  if (tab === "Counter") renderCounter();
  if (tab === "Visits & Posts") loadMyVisits("business");
  if (tab === "Content") renderContentTab();
  if (tab === "Analytics") renderAnalyticsTab();
  if (tab === "Plan") renderPlanTab();
  if (tab === "Messages") loadThreads();
  if (tab === "Profile") renderBizProfileTab();
  if (tab === "More") renderMoreScreen();
  if (tab === "Settings") renderSettingsTab();
  if (tab === "Help") renderHelpTab();
}

// Shared in-app notifications block (the no-ghosting surface):
// application outcomes, backfill offers, nudges, and decisions
// land here for both roles, newest first.
async function loadNotificationsInto(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  try {
    const data = await api("GET", "/notifications");
    if (!document.getElementById(elId)) return;
    if (!data.notifications.length) { el.innerHTML = ""; return; }
    state.badges = data.badges || state.badges;
    renderBottomNav();
    el.innerHTML = `<div class="panel"><h3 style="margin-top:0">Updates</h3>${data.notifications.slice(0, 8).map((n) => `<p class="small" style="margin:6px 0"><span class="muted">${esc(fmtDate(n.createdAt))}</span> ${esc(n.text)}</p>`).join("")}</div>`;
    // Badges (Wave 3c fix): do NOT mark notes read here. This loader runs on
    // every dashboard render, so marking read on load wiped the tab badges
    // in the same paint they appeared (rendered QA 2026-10-24: business
    // badges never survived to a screenshot). Notes count as read once the
    // user navigates away from the dashboard showing the Updates panel;
    // go() flushes the pending read.
    if (data.unreadCount) state.notesReadPending = true;
  } catch (e) { /* notifications are an enhancement, never a blocker */ }
}

// The real Business Home: the Preview home's computations fed by
// this business's real bookings, offers, and applications (GET
// /me/business-home). Same layout, same definitions, real data.
// How post numbers reached us (UX redesign section 7): creator
// numbers are labeled as creator-reported unless the metrics sync
// supplied them, so a business never mistakes a hand-entered count
// for a platform pull.
function perfSourceLabel(source) {
  return source === "meta_sync" ? "Synced from Instagram" : "Creator-reported";
}

// The ROAS stat cell (UX redesign section 7): with nothing
// tracked, estimated, or modeled yet, show the starting state and
// the way in, never a bare 0.00x. Otherwise the score rides with
// its basis lines: what is tracked, what is estimated from code
// uses at the business's average ticket, what is modeled media.
function roasCellHtml(h, navButton) {
  const r = h.roas || null;
  const score = h.roasScore;
  const hasTracked = !!(r && r.registerValue > 0);
  const hasEstimate = !!(r && r.estimatedRegisterValue > 0);
  const hasMedia = !!(r && r.mediaValue > 0);
  if ((score === null || score === undefined || Number(score) === 0) && !hasTracked && !hasEstimate && !hasMedia) {
    return `<div class="stat-cell"><div class="stat-num grad-text" style="font-size:1.1rem">No results yet</div><div class="stat-lbl">SIGNL ROAS Score — starts with your first register tally.</div>${navButton ? `<button class="btn small-btn" style="margin-top:6px" onclick="return go('dashboard','Visits &amp; Posts')">Go to Visits &amp; Posts</button>` : ""}</div>`;
  }
  const basis = [
    hasTracked ? `Register $${fmtMoney(r.registerValue)} tracked` : null,
    hasEstimate && r.registerEstimate ? `About $${fmtMoney(r.estimatedRegisterValue)} estimated from ${r.registerEstimate.uses} code uses at your $${fmtMoney(r.registerEstimate.avgTicket)} average ticket` : null,
    hasMedia ? `Media $${fmtMoney(r.mediaValue)} modeled` : null,
  ].filter(Boolean).join("<br>");
  return `<div class="stat-cell"><div class="stat-num grad-text">${score === null || score === undefined ? "n/a" : Number(score).toFixed(2) + "&times;"}</div><div class="stat-lbl">SIGNL ROAS Score (register tallies plus modeled media value)${basis ? `<br>${basis}` : ""}</div></div>`;
}

// ---------- business dashboard: a segmented report ----------
// Jeff (2026-10-25): the business dashboard was one endless
// scroll. It is a report now: a slim KPI band, then a segmented
// switch — Overview | Needs you (badged) | Campaigns | Results —
// with every block the old scroll carried inside its segment.
// The live Home and the preview twin build their segments from
// these same builders, so the two never drift apart.
function dashSegsHtml(needsCount) {
  // Overhaul Stage 1 segment names: Overview | Activity (badged
  // with the needs-you count) | Offers | Analytics.
  return homeSegsHtml([["overview", "Overview"], ["activity", "Activity", needsCount || 0], ["offers", "Offers"], ["analytics", "Analytics"]]);
}
function dashSeg(id, btn) {
  const root = btn && btn.closest ? btn.closest("[data-dash]") : null;
  if (!root) return false;
  root.querySelectorAll("[data-seg]").forEach((s) => { s.hidden = s.getAttribute("data-seg") !== id; });
  root.querySelectorAll("[data-segbtn]").forEach((b) => b.classList.toggle("on", b.getAttribute("data-segbtn") === id));
  return false;
}
function bizDashAttentionHtml(h, opts) {
  const o = opts || {};
  const all = h.attention || [];
  // The Needs-you badge counts the unset staff PIN as a task too
  // (loadBusinessHome's needsCount), so an overview that names the
  // PIN alongside the attention items keeps the two numbers in
  // agreement on one screen (perfection pass, 2026-10-26).
  const pin = !!o.pinItem;
  const total = all.length + (pin ? 1 : 0);
  if (!total) return `<div class="notice blue" style="margin-top:16px"><strong>Nothing needs your attention.</strong> Every visit is on track.</div>`;
  const items = o.limit ? all.slice(0, o.limit) : all;
  return `<div class="notice" style="margin-top:16px"><strong>${total} item${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} your attention.</strong>
    ${items.map((a) => `<br><strong>${esc(a.label)}:</strong> ${esc(a.detail)}${o.actions && a.kind === "offer_nudge" ? ` <button class="btn small-btn" onclick="fixOffer('${esc(a.offerId)}','raise')">Raise comp +$25</button> <button class="btn small-btn ghost" onclick="fixOffer('${esc(a.offerId)}','widen')">Widen window +3 days</button>` : ""}${o.actions && a.kind === "applications" ? ` <button class="btn small-btn" onclick="return goApplicants('${esc(a.offerId)}')">Review the stack</button>` : ""}`).join("")}
    ${pin ? `<br><strong>Staff PIN:</strong> not set yet. Your team redeems visits with it, never your login. <button class="btn small-btn" onclick="return go('dashboard','Plan')">Set the staff PIN</button>` : ""}
    ${o.limit && all.length > items.length ? `<br><span class="small">+ ${all.length - items.length} more under Needs you.</span>` : ""}</div>`;
}
function bizDashPipelineHtml(h) {
  const stages = [
    [h.pipeline.invited, "Invited", "Bookings created"],
    [h.pipeline.claimed, "Claimed", "Codes issued"],
    [h.pipeline.visitSet, "Visit set", "Windows open"],
    [h.pipeline.clockRunning, "48h clock", "Visits redeemed"],
    [h.pipeline.live, "Live", "Posts delivered"],
  ];
  return `<h4>Visit pipeline</h4>
    <div class="pv-funnel">${stages.map(([n, label, sub]) => `<div class="pv-stage"><div class="pv-stage-num">${n}</div><div class="pv-stage-lbl">${label}</div><div class="pv-stage-sub">${sub}</div></div>`).join("")}</div>`;
}
function bizDashPaceHtml(h, planName, billingStatus) {
  return `<h4>Plan pace</h4>
    <div class="flex-between"><span class="small"><strong>${esc(planName)} plan:</strong> ${h.visitsUsed} of ${h.visitsAllowance} visits booked this month</span><span class="badge ${h.planPacePct >= 100 ? "warn" : "info"}">${h.planPacePct}%</span></div>
    <div class="meter" style="margin-top:8px"><i style="width:${Math.min(100, h.planPacePct)}%"></i></div>
    ${h.visitsCarried ? `<p class="small muted">${h.visitsCarried} unused visit${h.visitsCarried === 1 ? "" : "s"} rolled over from last month. Rolled visits expire at the end of this month.</p>` : `<p class="small muted">Unused visits roll into next month and expire at the end of it.</p>`}
    ${billingStatus ? `<p class="small muted">${esc(billingStatus)}</p>` : ""}`;
}
function bizDashContentRowsHtml(h) {
  return (h.topContent || []).map((c) => `
    <div class="ui-row"><span class="k"><strong>${esc(c.title)}</strong> with @${esc(c.creatorHandle)}<br><span class="small muted">${fmtNum(c.views)} views &middot; ${fmtNum(c.likes)} likes &middot; ${c.onTime ? "posted on time" : "posted late"}${c.roasScore !== null && c.roasScore !== undefined && c.redemptions && c.redemptions.count > 0 ? ` &middot; SIGNL ROAS ${c.roasScore.toFixed(2)}&times;` : ""}${c.performanceUpdatedAt ? `<br>${perfSourceLabel(c.performanceSource)}, updated ${fmtDay(c.performanceUpdatedAt)}` : ""}</span></span><span class="v">${c.redemptions ? `${c.redemptions.count} code uses<br>$${fmtMoney(c.redemptions.basketTotal)} rung up` : "No tally yet"}</span></div>`).join("");
}
function bizDashNextRowsHtml(h, tickWhen) {
  return (h.nextVisits || []).map((n) => `
    <div class="ui-row"><span class="k"><strong>${esc(n.title)}</strong> with @${esc(n.creatorHandle)}<br><span class="small muted">${esc(n.stateLabel)}${n.dueInLabel ? ` &middot; ${esc(n.dueInLabel)}` : ""}</span></span><span class="v">${esc(n.whenLabel)}<br>${tickWhen ? `<span class="pv-tick" data-kind="left" data-target="${esc(n.when || "")}"></span>` : esc(fmtDate(n.when))}</span></div>`).join("");
}

// Feed taxonomy for the business home (Grin Feed pattern mapped
// to SIGNL's real notification kinds + content records). Events
// only exist when a real record does; a chip with no records
// shows its own explained empty state.
const BIZ_FEED_KINDS = [["all", "All"], ["applications", "Applications"], ["invites", "Invites"], ["messages", "Messages"], ["posts", "Posts"], ["visits", "Visits"], ["licenses", "Licenses"]];
function bizFeedKindOf(noteKind) {
  const k = String(noteKind || "");
  if (/^application_|^backfill_|creator_declined|offer_declined/.test(k)) return "applications";
  if (k === "message_received") return "messages";
  if (/^performance_/.test(k)) return "posts";
  if (/license/.test(k)) return "licenses";
  if (/^offer_received$|^invite/.test(k)) return "invites";
  if (/visit|redeem|clock|deadline|booking|tally|window|overdue|complete|paid|payment|payout/.test(k)) return "visits";
  return "updates";
}
function bizFeedEvents(h, notes) {
  const evs = [];
  const actFor = (kind) => kind === "applications" ? { label: "Review", onclick: "return goApplicants()" }
    : kind === "messages" ? { label: "Open", onclick: "return go('dashboard','Messages')" }
    : kind === "posts" || kind === "licenses" ? { label: "Review", onclick: "return go('dashboard','Content')" }
    : { label: "Review", onclick: "return go('dashboard','Visits & Posts')" };
  for (const n of notes || []) {
    const kind = bizFeedKindOf(n.kind);
    const kindLabel = { applications: "Application", invites: "Invite", messages: "Message", posts: "Post", visits: "Visit", licenses: "License", updates: "Update" }[kind];
    evs.push({ kind, at: n.createdAt, title: esc(n.text), meta: kindLabel, icon: kind === "messages" ? "chat" : kind === "applications" ? "inbox" : "visits", act: actFor(kind) });
  }
  for (const r of h.contentLibrary || []) {
    evs.push({ kind: "posts", at: r.postedAt, title: `Post live: ${esc(r.title)}`, meta: `@${esc(r.creatorHandle)} · ${fmtNum(r.views || 0)} views · ${r.onTime ? "on time" : "late"}`, icon: "image", acc: true, act: actFor("posts") });
    if (r.license && r.license.type !== "native") {
      evs.push({ kind: "licenses", at: r.postedAt, title: `${r.license.type === "licensed" ? "Licensed post" : "Standard license"}: ${esc(r.title)}`, meta: r.license.daysLeft === null || r.license.daysLeft === undefined ? "90-day window from the post date" : r.license.daysLeft < 0 ? "The reuse window has ended" : `${r.license.daysLeft} days left to repost and run ads`, icon: "shield", acc: true, act: actFor("licenses") });
    }
  }
  evs.sort((a, b) => (Date.parse(b.at || "") || 0) - (Date.parse(a.at || "") || 0));
  return evs;
}
let bizFeedKind = "all";
function bizFeedSet(kind) {
  bizFeedKind = kind;
  const host = document.getElementById("biz-feed");
  if (host) host.innerHTML = bizFeedHtml(state.bizFeedEvents || []);
  return false;
}
function bizFeedHtml(events) {
  const chips = `<div class="feed-chips">${BIZ_FEED_KINDS.map(([k, label]) => `<button type="button" class="fchip ${bizFeedKind === k ? "on" : ""}" onclick="return bizFeedSet('${k}')">${label}</button>`).join("")}</div>`;
  const shown = bizFeedKind === "all" ? events : events.filter((e) => e.kind === bizFeedKind);
  if (!shown.length) {
    const label = (BIZ_FEED_KINDS.find(([k]) => k === bizFeedKind) || [])[1] || "Activity";
    return `${chips}<div class="feed-list"><div class="feed-empty"><div class="ec-t">Nothing here yet</div><div class="ec-s">${bizFeedKind === "all" ? "When a creator applies, visits, or posts, it shows up here." : `No ${label.toLowerCase()} events yet. They land here the moment they happen.`}</div></div></div>`;
  }
  return chips + feedListHtml(shown);
}

// Visit segments (spec §5.4 / §6.3): work organized by what
// the visit still needs, not by object type. Shared by the
// Visits screens and Sig's queue so the two never disagree.
function visitSegOf(b, role) {
  if (b.post) return "done";
  if (b.honorReportedAt || b.replacementRequestedAt) return "done";
  if (b.redeemedAt) return role === "business" ? "waiting" : "needs";
  if (b.status === "cancelled" || b.status === "expired") return "done";
  if (role === "business" && !b.visitDate && !b.redeemBy) return "needs";
  return "upcoming";
}

async function loadBusinessHome() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  const u = state.user;
  el.innerHTML = `${wsHead("Home", { sub: "Start here. Sig shows you what needs you, in order.", subKey: "biz-home" })}${skelHtml("Loading your home...", 3)}`;
  try {
    const d = await api("GET", "/me/business-home");
    const h = d.home;
    if (!document.getElementById("tab-body")) return;
    let notes = [];
    try {
      const nd = await api("GET", "/notifications");
      notes = nd.notifications || [];
      if (nd.unreadCount) state.notesReadPending = true;
      if (nd.badges) state.badges = nd.badges;
    } catch (e) { /* the feed degrades to content events only */ }
    let offers = [];
    let bookings = [];
    try { const od = await api("GET", "/offers"); offers = od.offers || []; } catch (e) { /* queue degrades */ }
    try { const bd = await api("GET", "/bookings"); bookings = bd.bookings || []; } catch (e) { /* queue degrades */ }
    const waiting = [];
    for (const o of offers.filter((x) => (x.applicationCount || 0) > 0).slice(0, 12)) {
      try {
        const ad = await api("GET", `/offers/${o.id}/applications`);
        for (const a of ad.applications || []) if (a.status === "applied") waiting.push({ offer: ad.offer || o, app: a });
      } catch (e) { /* one offer's stack never blocks the home */ }
    }
    state.waitCounts = state.waitCounts || {};
    state.waitCounts.bizApps = waiting.length;
    state.myOffers = offers;
    state.nudgeBookings = state.nudgeBookings || {};
    for (const bk of bookings) state.nudgeBookings[bk.id] = bk;

    // Sig's queue (spec §4.2/§4.3): deadlines first, then
    // people waiting, then new results, then setup gaps.
    // Within a class, oldest waiting first.
    const now = Date.now();
    const items = [];
    const add = (cls, at, text, btn, act) => items.push({ cls, at: at || now, text, btn, act });
    const due = waiting.filter((w) => addBizDays(Date.parse(w.app.createdAt) || now, 2) - now < 86400000)
      .sort((a, b) => (Date.parse(a.app.createdAt) || 0) - (Date.parse(b.app.createdAt) || 0));
    if (due.length) {
      const first = due[0];
      add(1, Date.parse(first.app.createdAt) || now, due.length === 1 ? `A decision is due today: ${first.app.creator.name} applied to "${first.offer.title}".` : `${due.length} decisions are due today. The oldest is ${first.app.creator.name} for "${first.offer.title}".`, "Decide", () => { if (!reqState) reqState = reqFreshState(); reqState.open[first.app.id] = true; goApplicants(first.offer.id); });
    }
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const sameDay = (iso) => { const t = Date.parse(iso || ""); return !Number.isNaN(t) && t >= startOfDay.getTime() && t < startOfDay.getTime() + 86400000; };
    const visitToday = bookings.filter((b) => !b.redeemedAt && !b.post && b.status !== "cancelled" && b.status !== "expired" && (sameDay(b.visitDate) || sameDay(b.redeemBy)));
    if (visitToday.length) {
      add(1, now, visitToday.length === 1 ? `${visitToday[0].creatorName} is visiting today.` : `${visitToday.length} visits are happening today.`, "Open counter", () => go("dashboard", "Counter"));
    }
    const postDue = bookings.filter((b) => b.redeemedAt && !b.post && b.postDeadline && (Date.parse(b.postDeadline) - now) <= 48 * 3600000 && b.status !== "cancelled")
      .sort((a, b) => (Date.parse(a.postDeadline) || 0) - (Date.parse(b.postDeadline) || 0));
    if (postDue.length) {
      const b = postDue[0];
      const overdue = Date.parse(b.postDeadline) < now;
      add(1, Date.parse(b.postDeadline) || now, `${b.creatorName} visited ${fmtDay(b.redeemedAt)} and the post is ${overdue ? "overdue" : "due " + dueDayWords(b.postDeadline)}.`, "Send a nudge", (btn) => sendNudge(b.id, btn));
    }
    if (waiting.length) {
      const oldest = waiting.slice().sort((a, b) => (Date.parse(a.app.createdAt) || 0) - (Date.parse(b.app.createdAt) || 0))[0];
      add(2, Date.parse(oldest.app.createdAt) || now, `${waiting.length} creator${waiting.length === 1 ? " is" : "s are"} waiting on your answer.`, "Review", () => goApplicants());
    }
    const needsTime = bookings.filter((b) => visitSegOf(b, "business") === "needs");
    if (needsTime.length) add(2, now, `${needsTime.length} visit${needsTime.length === 1 ? " needs" : "s need"} a time.`, "Set the visit", () => { state.visitsSeg = "needs"; go("dashboard", "Visits & Posts"); });
    const msgCount = (state.badges && state.badges.messages) || 0;
    if (msgCount) add(2, now, `${msgCount} message${msgCount === 1 ? " is" : "s are"} waiting.`, "Read", () => go("dashboard", "Messages"));
    const lib = h.contentLibrary || [];
    const freshPost = lib.filter((r) => r.postedAt && now - Date.parse(r.postedAt) < 14 * 86400000).sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0))[0];
    if (freshPost) add(3, Date.parse(freshPost.postedAt) || now, `${freshPost.creatorName || "A creator"}'s post is live: "${freshPost.title}".`, "See the post", () => go("dashboard", "Content"));
    const licRow = lib.find((r) => r.license && r.license.type === "native" && bookings.some((b) => b.post && b.id === r.bookingId && Number(b.creatorLicensingFee) > 0));
    if (licRow) {
      const bk = bookings.find((b) => b.id === licRow.bookingId);
      add(3, Date.parse(licRow.postedAt) || now, `You can license ${licRow.creatorName}'s post for $${fmtPrice(bk.creatorLicensingFee)}.`, "License it", () => go("dashboard", "Content"));
    }
    const bz = u.business || {};
    if (!bz.about) add(4, now, "Your business page is missing its About.", "Add about", () => go("dashboard", "Profile"));
    if (d.staffPinSet === false) add(4, now, "Set your staff PIN so your team can redeem visits.", "Set PIN", () => go("dashboard", "Settings"));
    if ((h.visitsCarried || 0) > 0 && h.carriedExpiresAt) add(4, now, `${h.visitsCarried} rolled visit${h.visitsCarried === 1 ? "" : "s"} expire ${dueDayWords(h.carriedExpiresAt)}.`, "See plan", () => go("dashboard", "Plan"));
    else if ((h.visitsRemaining || 0) <= 1) add(4, now, `You have ${h.visitsRemaining || 0} visit${(h.visitsRemaining || 0) === 1 ? "" : "s"} left this month.`, "See plan", () => go("dashboard", "Plan"));
    state.waitCounts.bizVisits = visitToday.length + postDue.length + needsTime.length;
    items.sort((a, b) => a.cls - b.cls || a.at - b.at);
    const queue = items.slice(0, 7);

    // The launch checklist (spec §4.6): retires for good once
    // every step is done.
    const steps = [
      { label: "Finish your business page", sub: "Your name, category, and what creators get.", done: !!(bz.businessName && bz.category && bz.about), btn: "Edit page", act: () => go("dashboard", "Profile") },
      { label: "Post your first offer", sub: "Comped visit, paid booking, or open call.", done: offers.length > 0, btn: "Post offer", act: () => { state.offersSeg = "live"; go("dashboard", "My Offers"); } },
      { label: "Find creators and send first invite", sub: "Flip through creators near you, invite the ones who fit.", done: offers.some((o) => o.lane === "direct") || bookings.length > 0, btn: "Find creators", act: () => go("dashboard", "Discover") },
      { label: "You are live", sub: "When creators apply, Sig puts them at the top of this screen.", done: offers.some((o) => ["open", "filled", "closed"].includes(o.status)) },
    ];
    const fresh = !steps[0].done || !offers.length;
    const greetLine = fresh ? "Let's get your first campaign live. Sig walks you through it, four steps." : (queue.length ? queue[0].text : "You're all caught up.");
    const hasNumbers = (h.postsLive || 0) > 0 || (h.localReachDelivered || 0) > 0 || (h.visitsUsed || 0) > 0;
    const snapCells = hasNumbers ? [
      { num: fmtNum(h.localReachDelivered || 0), label: "Local reach delivered" },
      { num: fmtNum(h.postsLive || 0), label: "Posts live" },
      { num: `${h.visitsUsed || 0} of ${h.visitsAllowance || 0}`, label: "Visits this month" },
    ] : null;
    const caughtLinks = [
      { label: "Find creators", act: () => go("dashboard", "Discover") },
      { label: "Post an offer", act: () => { state.offersSeg = "live"; go("dashboard", "My Offers"); } },
    ];
    state.bizFeedEvents = bizFeedEvents(h, notes);
    bizFeedKind = "all";
    el.innerHTML = `
    <div data-dash>
    ${wsHead("Home", { sub: "Start here. Sig shows you what needs you, in order.", subKey: "biz-home" })}
    <div class="home-greet"><div class="hg-hi">Hi, ${esc(bz.businessName || u.name || "")}</div><div class="hg-line">${esc(greetLine)}</div></div>
    ${d.marketLive ? "" : `<div class="notice blue" style="margin-top:14px"><strong>Your market opens in 30–90 days.</strong> Draft offers now; publishing switches on at launch.</div>`}
    ${sigQueueHtml(queue, { links: caughtLinks })}
    ${checklistHtml(steps)}
    ${snapshotHtml(snapCells, "This fills in once your campaigns are live. When creators start visiting and posting, you will see applications, visits, posts, and the local reach they delivered, right here.", "Analytics")}
    <h3 style="margin:20px 0 0">Activity</h3>
    <div id="biz-feed">${bizFeedHtml(state.bizFeedEvents)}</div>
    ${hasNumbers ? `<button type="button" class="more-row results-row" onclick="return go('dashboard','Analytics')"><span class="more-ic">${bnIcon("bars")}</span><span class="more-tx"><span class="more-label">Results</span><span class="more-sub">What your campaigns did.</span></span><span class="more-chev">›</span></button>` : ""}
    ${askSigRowHtml()}
    </div>`;
    wireSigQueue(el, queue, caughtLinks);
    wireChecklist(el, steps);
    renderBottomNav();
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}
// ---------- Requests: the approvals queue (Grin Approvals) ----------
// Tabs with counts (Waiting / Decided / Later), search + offer
// filter + sort, aging with SIGNL's real decision window (2
// business days — no invented auto-close), checkbox bulk select,
// expandable rows with a plain-words match reason, and a kebab
// menu mirroring Grin's: View creator profile / Ask Sig / Select
// / Request info / Later / Release. "Later" is a local park on
// this device; it never changes the application itself.
let reqState = null;
function reqFreshState() {
  return { tab: "waiting", q: "", offerId: "", sort: "fit", sel: {}, open: {}, later: JSON.parse(localStorage.getItem("signl-req-later") || "{}"), rows: [], offers: [], loaded: false };
}
function reqSaveLater() { try { localStorage.setItem("signl-req-later", JSON.stringify(reqState.later)); } catch (e) { /* private mode */ } }
function reqAgeLabel(iso) {
  const ms = Date.now() - (Date.parse(iso || "") || Date.now());
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `waiting ${days} day${days === 1 ? "" : "s"}`;
  const hrs = Math.max(Math.floor(ms / 3600000), 0);
  return hrs >= 1 ? `waiting ${hrs}h` : "just in";
}
function reqBuckets() {
  const rows = reqState.rows;
  const waiting = rows.filter((r) => r.app.status === "applied" && !reqState.later[r.app.id]);
  const later = rows.filter((r) => r.app.status === "applied" && reqState.later[r.app.id]);
  const decided = rows.filter((r) => r.app.status !== "applied");
  return { waiting, later, decided };
}
let reqEmbed = false;
async function renderRequestsTab(embed) {
  reqEmbed = !!embed;
  const el = document.getElementById(embed ? "offers-seg-body" : "tab-body");
  if (!el) return;
  if (!reqState) reqState = reqFreshState();
  el.innerHTML = `${embed ? `<div class="req-banner">Every applicant gets an answer within 2 business days. That is the deal.</div>` : wsHead("Requests", { sub: "Creators waiting on your decision." })}<div id="req-main">${skelHtml("Loading requests...", 2)}</div>`;
  try {
    if (!reqState.loaded) {
      const od = await api("GET", "/offers");
      const offers = (od.offers || []).filter((o) => (o.applicationCount || 0) > 0);
      reqState.offers = offers;
      const rows = [];
      for (const o of offers.slice(0, 12)) {
        const d = await api("GET", `/offers/${o.id}/applications`);
        for (const a of d.applications || []) rows.push({ offer: d.offer || o, app: a });
      }
      reqState.rows = rows;
      reqState.loaded = true;
      // One source of truth (spec §2.1): the waiting count
      // computed here is the Offers tab badge and the Home
      // queue count.
      const b = reqBuckets();
      state.waitCounts = state.waitCounts || {};
      state.waitCounts.bizApps = b.waiting.length;
      renderOffersSegTabs();
      renderBottomNav();
    }
    renderReqMain();
  } catch (err) {
    el.innerHTML = `${reqEmbed ? "" : wsHead("Requests")}<div class="error-box">${esc(err.message)}</div>`;
  }
}
function reqFiltered(bucket) {
  let rows = bucket.slice();
  if (reqState.offerId) rows = rows.filter((r) => r.offer.id === reqState.offerId);
  const q = reqState.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => ((r.app.creator.name || "") + " " + (r.app.creator.handle || "")).toLowerCase().includes(q));
  if (reqState.sort === "newest") rows.sort((a, b) => (Date.parse(b.app.createdAt) || 0) - (Date.parse(a.app.createdAt) || 0));
  else if (reqState.sort === "local") rows.sort((a, b) => ((b.app.creator.localAudiencePct || 0) - (a.app.creator.localAudiencePct || 0)));
  else rows.sort((a, b) => ((b.app.rankScore || 0) - (a.app.rankScore || 0)));
  return rows;
}
function reqWhyHtml(r) {
  const c = r.app.creator || {};
  const rp = r.app.rankParts || {};
  const tr = c.trackRecord || {};
  const bits = [];
  if (c.localAudiencePct !== null && c.localAudiencePct !== undefined) bits.push(`${c.localAudiencePct}% of their audience lives in your market`);
  if (c.tierBand) bits.push(`${c.tierBand} tier`);
  if (rp.impactScore !== null && rp.impactScore !== undefined) bits.push(`local impact score ${rp.impactScore}`);
  if (tr.visitsCompleted) bits.push(`${tr.visitsCompleted} visit${tr.visitsCompleted === 1 ? "" : "s"} completed, ${tr.onTimePct === null || tr.onTimePct === undefined ? "no late posts" : tr.onTimePct + "% on time"}`);
  else bits.push("new to SIGNL, no visits yet");
  if (rp.momentum) bits.push(`${rp.momentum} Momentum points`);
  return `<div class="req-why"><strong>Matched because:</strong> ${esc(bits.join(" · "))}.</div>`;
}
function reqRowHtml(r) {
  const a = r.app;
  const c = a.creator || {};
  const open = !!reqState.open[a.id];
  const statusBadge = { applied: `<span class="badge info">Waiting</span>`, selected: `<span class="badge ok">Selected</span>`, released: `<span class="badge">Released</span>`, expired: `<span class="badge">Window passed</span>`, backfill_offered: `<span class="badge warn">Backfill offered</span>`, backfill_accepted: `<span class="badge ok">Took backfill</span>` }[a.status] || esc(a.status);
  const menu = `<div class="kebab-menu">
    <button type="button" onclick="openCreatorProfile('${c.userId}')">View creator profile</button>
    <button type="button" onclick="openAgentSheet()">Ask Sig</button>
    ${a.status === "applied" ? `<button type="button" data-ctx="${esc(r.offer.title)}" onclick="return openThreadCtx('${c.userId}', this.dataset.ctx)">Request info</button>
    <button type="button" onclick="return reqLater('${a.id}')">${reqState.later[a.id] ? "Move back to waiting" : "Later"}</button>
    <div class="km-sep"></div>
    <button type="button" class="danger" onclick="return reqReleaseOne('${r.offer.id}','${a.id}')">Release</button>` : `<button type="button" data-ctx="${esc(r.offer.title)}" onclick="return openThreadCtx('${c.userId}', this.dataset.ctx)">Message</button>`}
  </div>`;
  return `<div class="req-row" id="reqrow-${a.id}">
    <div class="req-top">
      ${a.status === "applied" && reqState.tab === "waiting" ? `<input type="checkbox" class="req-check" ${reqState.sel[a.id] ? "checked" : ""} onchange="reqToggleSel('${a.id}', this.checked)" aria-label="Select ${esc(c.name || "creator")}">` : ""}
      <span class="req-ava">${esc((c.name || "?").trim().charAt(0).toUpperCase() || "?")}</span>
      <div class="req-main" onclick="return reqToggleOpen('${a.id}')" style="cursor:pointer">
        <div class="req-name">${esc(c.name || "")} ${statusBadge}</div>
        <div class="req-meta">@${esc(c.handle || "")} · for <strong>${esc(r.offer.title)}</strong></div>
      </div>
      <span class="kebab-wrap"><button type="button" class="kebab-btn" aria-label="More actions" onclick="return reqKebab(event,'${a.id}')">&#8943;</button>${reqState.kebab === a.id ? menu : ""}</span>
    </div>
    <div class="req-body">
      <div class="req-meta">applied ${fmtDay(a.createdAt)}${a.status === "applied" ? ` · ${reqAgeLabel(a.createdAt)}` : a.decidedAt ? ` · decided ${fmtDay(a.decidedAt)}` : ""}${c.localAudiencePct !== null && c.localAudiencePct !== undefined ? ` · ${c.localAudiencePct}% local` : ""}${c.totalAudience ? ` · ${fmtNum(c.totalAudience)} audience` : ""}${c.tierBand ? ` · ${esc(c.tierBand)}` : ""}</div>
      ${open ? reqWhyHtml(r) : ""}
      ${a.status === "applied" ? `<div class="req-acts">
        <button type="button" class="btn small-btn ws-primary" onclick="return reqSelectOne('${r.offer.id}','${a.id}')">Select</button>
        <button type="button" class="btn small-btn ws-outline" data-ctx="${esc(r.offer.title)}" onclick="return openThreadCtx('${c.userId}', this.dataset.ctx)">Request info</button>
        <button type="button" class="btn small-btn ws-outline" onclick="return reqLater('${a.id}')">${reqState.later[a.id] ? "Back to waiting" : "Later"}</button>
        <button type="button" class="btn small-btn ws-outline" onclick="return reqToggleOpen('${a.id}')">${open ? "Hide match" : "Why this match"}</button>
        <button type="button" class="btn small-btn ws-outline danger" onclick="return reqReleaseOne('${r.offer.id}','${a.id}')">Release</button>
      </div>` : ""}
    </div>
  </div>`;
}
function renderReqMain() {
  const host = document.getElementById("req-main");
  if (!host || !reqState) return;
  const b = reqBuckets();
  const bucket = reqState.tab === "waiting" ? b.waiting : reqState.tab === "later" ? b.later : b.decided;
  const rows = reqFiltered(bucket);
  const oldest = b.waiting.length ? Math.max(...b.waiting.map((r) => Date.now() - (Date.parse(r.app.createdAt) || Date.now()))) : 0;
  const selCount = Object.keys(reqState.sel).filter((k) => reqState.sel[k]).length;
  host.innerHTML = `
    ${wsTabs([
      { label: "Waiting", count: b.waiting.length, on: reqState.tab === "waiting", onclick: "return reqSetTab('waiting')" },
      { label: "Decided", count: b.decided.length, on: reqState.tab === "decided", onclick: "return reqSetTab('decided')" },
      { label: "Later", count: b.later.length, on: reqState.tab === "later", onclick: "return reqSetTab('later')" },
    ])}
    ${reqState.tab === "waiting" && b.waiting.length ? `<div class="req-alert"><strong>${b.waiting.length} unreviewed application${b.waiting.length === 1 ? "" : "s"}.</strong> SIGNL's promise is a decision within 2 business days${oldest >= 2 * 86400000 ? ` — the oldest has been waiting ${Math.floor(oldest / 86400000)} days` : ""}. Every applicant hears back, either way.</div>` : ""}
    <div class="ws-tools">
      <span class="ws-search">${bnIcon("search")}<input id="req-q" type="search" placeholder="Search creators" value="${esc(reqState.q)}" oninput="reqSetQ(this.value)"></span>
      <select class="ws-select" onchange="reqSetOffer(this.value)" aria-label="Filter by offer"><option value="">All offers</option>${reqState.offers.map((o) => `<option value="${o.id}" ${reqState.offerId === o.id ? "selected" : ""}>${esc(o.title)}</option>`).join("")}</select>
      <select class="ws-select" onchange="reqSetSort(this.value)" aria-label="Sort requests">
        <option value="fit" ${reqState.sort === "fit" ? "selected" : ""}>Best fit</option>
        <option value="newest" ${reqState.sort === "newest" ? "selected" : ""}>Newest</option>
        <option value="local" ${reqState.sort === "local" ? "selected" : ""}>Local reach</option>
      </select>
    </div>
    ${rows.length ? `<div class="req-list">${rows.map(reqRowHtml).join("")}</div>` : `<div class="empty-card"><div class="ec-t">${reqState.tab === "waiting" ? "No applicants yet" : "No requests here"}</div><div class="ec-s">${reqState.tab === "waiting" ? "Invite creators directly, or share your offer, and applications land here. Every applicant gets an answer within 2 business days." : reqState.tab === "later" ? "Applications you park for later sit here. Parking never notifies the creator." : "Decisions you make show up here, so the record is never a mystery."}</div></div>`}
    ${selCount ? `<div class="req-bulk"><span>${selCount} selected</span><button type="button" class="btn small-btn" onclick="return reqBulk('select')">Select all</button><button type="button" class="btn small-btn ghost" style="color:#fff;border-color:#3A443C" onclick="return reqBulk('release')">Release</button><button type="button" class="linklike" style="color:#C6CFC6" onclick="return reqClearSel()">Clear</button></div>` : ""}`;
  wireReady(host);
}
function reqSetTab(t) { reqState.tab = t; reqState.kebab = null; renderReqMain(); return false; }
function reqSetQ(v) { reqState.q = v; const host = document.getElementById("req-main"); renderReqMain(); const inp = document.getElementById("req-q"); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } return false; }
function reqSetOffer(v) { reqState.offerId = v; renderReqMain(); return false; }
function reqSetSort(v) { reqState.sort = v; renderReqMain(); return false; }
function reqToggleSel(id, on) { reqState.sel[id] = on; renderReqMain(); return false; }
function reqClearSel() { reqState.sel = {}; renderReqMain(); return false; }
function reqToggleOpen(id) { reqState.open[id] = !reqState.open[id]; renderReqMain(); return false; }
function reqKebab(e, id) { if (e) e.stopPropagation(); reqState.kebab = reqState.kebab === id ? null : id; renderReqMain(); return false; }
function reqLater(id) { if (reqState.later[id]) delete reqState.later[id]; else reqState.later[id] = 1; reqSaveLater(); reqState.kebab = null; renderReqMain(); return false; }
async function reqSelectOne(offerId, appId) {
  // Direct API (not selectApplicant): that helper re-renders My
  // Offers on success, which would fight this screen's refresh.
  try {
    await api("POST", `/offers/${offerId}/select`, { applicationId: appId });
  } catch (err) { alert(err.message); return false; }
  reqState.loaded = false; reqState.sel = {};
  renderRequestsTab(reqEmbed);
  return false;
}
async function reqReleaseOne(offerId, appId) {
  if (!window.confirm("Release this applicant? They are told right away, with the reason in plain words.")) return false;
  try {
    await api("POST", `/offers/${offerId}/release`, { applicationId: appId });
  } catch (err) { alert(err.message); return false; }
  reqState.loaded = false; reqState.kebab = null;
  renderRequestsTab(reqEmbed);
  return false;
}
async function reqBulk(which) {
  const b = reqBuckets();
  const chosen = b.waiting.filter((r) => reqState.sel[r.app.id]);
  if (!chosen.length) return false;
  if (!window.confirm(`${which === "select" ? "Select" : "Release"} ${chosen.length} application${chosen.length === 1 ? "" : "s"}? ${which === "select" ? "Each one books its visit." : "Each creator is told, kindly and with a reason."}`)) return false;
  for (const r of chosen) {
    try { await api("POST", `/offers/${r.offer.id}/${which === "select" ? "select" : "release"}`, { applicationId: r.app.id }); }
    catch (e) { alert(e.message); break; }
  }
  reqState.loaded = false; reqState.sel = {};
  renderRequestsTab(reqEmbed);
  return false;
}

// ---------- Content: posts + rights (Grin Content) ----------
let contentTab = "creator";
function contentSetTab(t) { contentTab = t; renderContentTab(); return false; }
function libRowsHtml(h, mode, licMap) {
  const lib = h.contentLibrary || [];
  const rows = mode === "yours" ? lib.filter((r) => r.license && r.license.type !== "native") : lib;
  if (!rows.length) return `<div class="empty-card"><div class="ec-t">${mode === "yours" ? "Nothing licensed yet" : "No posts yet"}</div><div class="ec-s">${mode === "yours" ? "Posts you can repost or run as ads appear here: paid bookings carry one 90-day license, and comped posts can be licensed from the creator." : "When a creator posts about your business, it lands here, and you can license the ones you want to reuse."}</div></div>`;
  return `<div class="wcard" style="padding-top:8px;padding-bottom:8px">${rows.map((r) => {
    const lic = (licMap || {})[r.bookingId];
    const canLicense = mode === "creator" && r.license && r.license.type === "native" && lic && lic.fee > 0 && lic.postId;
    return `
    <div class="lib-row"><div class="lib-main"><div class="lib-title">${esc(r.title)}</div>
    <div class="lib-meta">@${esc(r.creatorHandle)} · ${r.postedAt ? fmtDay(r.postedAt) : ""} · ${fmtNum(r.views)} views · ${fmtNum(r.likes)} likes · ${fmtNum(r.localReach || 0)} local reach · ${r.onTime ? "on time" : "late"}${r.redemptions && r.redemptions.count ? ` · ${r.redemptions.count} code uses · $${fmtMoney(r.redemptions.basketTotal)} rung up` : ""}${r.postUrl ? ` · <a href="${esc(r.postUrl)}" target="_blank" rel="noopener">View post</a>` : ""}</div></div>${licPillHtml(r.license)}${canLicense ? (lic.requested ? `<span class="lic-pill">License requested</span>` : `<button type="button" class="btn small-btn ws-primary" onclick="requestLicense('${lic.postId}', ${lic.fee})">Request license</button>`) : ""}</div>`;
  }).join("")}</div>`;
}
async function renderContentTab() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  el.innerHTML = `${wsHead("Posts & licenses")}${skelHtml("Loading posts...", 2)}`;
  try {
    const d = await api("GET", "/me/business-home");
    const h = d.home;
    const lib = h.contentLibrary || [];
    const usable = lib.filter((r) => r.license && r.license.type !== "native").length;
    // License actions join each post to its booking: the fee
    // and post id live on the booking, not the library row.
    const licMap = {};
    try {
      const bd = await api("GET", "/bookings");
      const lr = await api("GET", "/license-requests").catch(() => ({ licenseRequests: [] }));
      const pendingPosts = new Set((lr.licenseRequests || []).filter((l) => l.status === "pending").map((l) => l.postId));
      for (const b of bd.bookings || []) if (b.post) licMap[b.id] = { postId: b.post.id, fee: Number(b.creatorLicensingFee) || 0, requested: pendingPosts.has(b.post.id) };
    } catch (e) { /* rows simply render without the action */ }
    el.innerHTML = `
    ${wsHead("Posts & licenses", { sub: "Every post about you, and the ones you can reuse.", subKey: "biz-content" })}
    <div class="rights-line">${bnIcon("shield")}<span><strong>Seeing a post here is not the right to reuse it.</strong> You may always reshare natively, with credit. Paid bookings include one standard license: 90 days to repost and run ads. A comped post can be licensed at the creator's listed fee, and the creator approves each use.</span></div>
    ${lib.length ? `<div class="track-card"><span class="feed-dot acc">${bnIcon("image")}</span><div class="tc-main"><div class="tc-t">Post tracking is on</div><div class="tc-s">${h.postsTracked30 || 0} post${(h.postsTracked30 || 0) === 1 ? "" : "s"} tracked in the last 30 days. SIGNL tracks every visit's post from the creator's report, timed against the 48 hour standard.</div></div><button type="button" class="btn small-btn ws-outline" onclick="return go('dashboard','Visits & Posts')">Visits</button></div>`
      : `<div class="track-card"><span class="feed-dot acc">${bnIcon("image")}</span><div class="tc-main"><div class="tc-t">Post tracking</div><div class="tc-s">Post tracking starts with your first visit.</div></div></div>`}
    ${wsTabs([
      { label: "Creator posts", count: lib.length, on: contentTab === "creator", onclick: "return contentSetTab('creator')" },
      { label: "Yours to use", count: usable, on: contentTab === "yours", onclick: "return contentSetTab('yours')" },
    ])}
    ${libRowsHtml(h, contentTab, licMap)}`;
  } catch (err) {
    el.innerHTML = `${wsHead("Posts & licenses")}<div class="error-box">${esc(err.message)}</div>`;
  }
}
// ---------- Analytics: charts, funnel, leaderboard (Grin mirror) ----------
let anaDays = 30;
function anaSetDays(v) { anaDays = Number(v) || 30; renderAnalyticsTab(); return false; }
async function renderAnalyticsTab() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  el.innerHTML = `${wsHead("Results")}${skelHtml("Loading your results...", 2)}`;
  try {
    const d = await api("GET", "/me/business-home");
    const h = d.home;
    const f = anaDays === 7 ? h.funnel7 : h.funnel30;
    const fp = anaDays === 7 ? h.funnelPrev7 : h.funnelPrev30;
    const series = h.series30 || [];
    const lb = h.leaderboard || [];
    const lib = h.contentLibrary || [];
    const head = wsHead("Results", { sub: "Your creator program in numbers, all from your real records.", subKey: "biz-results" });
    const f30 = h.funnel30 || {};
    const funnelSum = (f30.invited || 0) + (f30.claimed || 0) + (f30.visited || 0) + (f30.posted || 0);
    const appsWin = anaDays === 7 ? (h.applications7 || 0) : (h.applications30 || 0);
    const nothingLive = funnelSum === 0 && (h.applications30 || 0) === 0 && !lib.length && !(h.postsLive || 0);
    if (nothingLive) {
      // §8: the fills-in states, never a grid of zeros.
      const hasLiveOffer = (d.openOffers || 0) > 0 || (state.myOffers || []).some((o) => o.status === "open" || o.status === "filled");
      el.innerHTML = `${head}
      <div class="empty-card"><div class="ec-t">Your results</div><div class="ec-s">${hasLiveOffer ? "Your offer is live. This fills in as creators apply, visit, and post." : "This fills in once your campaigns are live. When creators start visiting and posting, you will see applications, visits, posts, and the local reach they delivered, right here."}</div></div>
      ${hasLiveOffer ? "" : `<p class="center"><button class="btn ws-primary" onclick="return go('dashboard','My Offers')">Post an offer</button></p>`}`;
      return;
    }
    // KPI cards render only when their records exist (§7).
    const r = h.roas || {};
    const cards = [];
    if (appsWin > 0) cards.push(kpiCard("Applications received", fmtNum(appsWin), { sub: `Last ${anaDays} days`, delta: deltaPill(appsWin, anaDays === 7 ? (h.applicationsPrev7 || 0) : (h.applicationsPrev30 || 0), "vs the prior period") }));
    if ((f.visited || 0) > 0) cards.push(kpiCard("Visits completed", fmtNum(f.visited), { sub: `Last ${anaDays} days`, delta: deltaPill(f.visited, fp.visited, "vs the prior period") }));
    if ((f.posted || 0) > 0) cards.push(kpiCard("Posts published", fmtNum(f.posted), { sub: `Last ${anaDays} days`, delta: deltaPill(f.posted, fp.posted, "vs the prior period") }));
    if ((h.localReachDelivered || 0) > 0) cards.push(kpiCard("Local reach delivered", fmtNum(h.localReachDelivered || 0), { sub: "All time, across delivered posts" }));
    if ((r.registerValue || 0) > 0) cards.push(kpiCard("Est. register value", `$${fmtMoney(r.registerValue)}`, { sub: "Tracked at the register from code tallies" }));
    else if ((r.estimatedRegisterValue || 0) > 0) cards.push(kpiCard("Est. register value", `≈ $${fmtMoney(r.estimatedRegisterValue)}`, { sub: "Estimated from code uses at your average ticket" }));
    const stages = [
      { label: "Invited", n: f.invited, cap: "Bookings created for your offers" },
      { label: "Accepted", n: f.claimed, cap: "Creators claimed their visit code" },
      { label: "Visit completed", n: f.visited, cap: "Codes redeemed at your register" },
      { label: "Post live", n: f.posted, cap: "Posts reported inside the window" },
    ];
    const seriesHas = series.some((row) => (row.invited || 0) > 0 || (row.decisions || 0) > 0);
    const reachHas = series.some((row) => (row.reach || 0) > 0);
    el.innerHTML = `
    ${head}
    ${cards.length ? `<div class="kpi-grid c${Math.min(4, Math.max(2, cards.length))}">${cards.join("")}</div>` : ""}
    ${seriesHas ? `<div class="chart-card"><h3>Invites &amp; decisions</h3><p class="wc-sub">Per day, last 30 days. Decisions are application answers, stamped when you make them.</p>
      ${lineChartSvg(series, [{ k: "invited", color: "#006AFC" }, { k: "decisions", color: "#B9C6BB" }])}
      <div class="chart-legend"><span><span class="legend-dot" style="background:#006AFC"></span>Invites</span><span><span class="legend-dot" style="background:#B9C6BB"></span>Decisions</span></div>
    </div>` : ""}
    ${reachHas ? `<div class="chart-card"><h3>Local reach over time</h3><p class="wc-sub">Local audience reached by posts that went live each day.</p>
      ${barsChartSvg(series, "reach", "#03C9AB")}
    </div>` : ""}
    ${!seriesHas && !reachHas ? `<div class="wcard"><h3>Charts</h3><p class="wc-sub" style="margin:4px 0 0">Charts fill in as your campaigns run: invites, decisions, and local reach, day by day.</p></div>` : ""}
    <div class="wcard"><div class="flex-between" style="flex-wrap:wrap;gap:10px"><h3 style="margin:0">Creator funnel</h3>${segSw([{ v: "7", label: "7 days" }, { v: "30", label: "30 days" }], String(anaDays), "anaSetDays")}</div>
      ${((f.invited || 0) + (f.claimed || 0) + (f.visited || 0) + (f.posted || 0)) > 0 ? `${funnel2Html(stages)}
      <p class="ana-note">Stages count real SIGNL events only. There is no email-open stage: SIGNL does not track opens, so the funnel starts at the invite itself.</p>` : `<p class="wc-sub" style="margin:6px 0 2px">Your funnel fills in once your campaigns are live: invited, accepted, visited, posted.</p>`}
    </div>
    <div class="wcard"><h3>Creators by local reach delivered</h3>
      ${lb.length ? lb.map((row, i) => `<div class="lb-row"><span class="lb-rank">${i + 1}</span><div class="lb-main"><div class="lb-name">${esc(row.creatorName)} <span class="muted" style="font-weight:600">@${esc(row.creatorHandle)}</span></div><div class="lb-meta">${row.posts} post${row.posts === 1 ? "" : "s"}${row.onTimePct !== null && row.onTimePct !== undefined ? ` · ${row.onTimePct}% on time` : ""}</div></div><span class="lb-num">${fmtNum(row.localReach)}<span class="u">local reach</span></span></div>`).join("") : `<p class="wc-sub" style="margin:6px 0 2px">Once posts land, your creators rank here by the local reach they delivered.</p>`}
    </div>
    ${h.costPerVisit && h.pipeline && (h.pipeline.clockRunning || 0) > 0 ? `<div class="wcard"><h3>Cost per visit</h3>
      <p style="margin:4px 0 0">Your plan works out to <strong>$${fmtMoney(h.costPerVisit)}</strong> per visit in your allowance${h.postsLive ? `, and every live post cost exactly one visit` : ""}. Register value and media value ride in your ROAS score on Home.</p>
    </div>` : ""}`;
  } catch (err) {
    el.innerHTML = `${wsHead("Results")}<div class="error-box">${esc(err.message)}</div>`;
  }
}
// ---------- Business Profile (Grin brand profile pattern) ----------
let bizProfTab = "profile";
function bizProfSet(t) { bizProfTab = t; renderBizProfileTab(); return false; }
async function renderBizProfileTab() {
  const el = document.getElementById("tab-body");
  if (!el) return;
  const u = state.user;
  const b = u.business || {};
  el.innerHTML = `${wsHead("Your business page")}${skelHtml("Loading your profile...", 1)}`;
  try {
    const d = await api("GET", "/me/business-home");
    const h = d.home;
    let reviews = [];
    try {
      const bd = await api("GET", "/bookings");
      reviews = (bd.bookings || []).filter((x) => x.businessReview).map((x) => ({ stars: x.businessReview.stars, text: x.businessReview.text, at: x.businessReview.createdAt, title: x.title, handle: x.creatorHandle }));
    } catch (e) { /* reviews are a bonus surface */ }
    const live = businessAccessState(u) === "active";
    const head = `
    ${wsHead("Your business page", { chip: live ? livePill("Live") : `<span class="beta-pill">Founding list</span>`, sub: "Your business's home on SIGNL. This card is how creators see you.", action: `<button type="button" class="btn ws-outline" onclick="return go('dashboard','My Offers')">See it as creators see it</button>` })}
    <div class="prof-card"><div class="prof-cover"></div><div class="prof-in">
      <div class="prof-ava">${esc((b.businessName || "?").trim().charAt(0).toUpperCase() || "?")}</div>
      <div class="prof-name">${esc(b.businessName || "")}${live ? `<span class="verified-dot">${bnIcon("check")}</span>` : ""}</div>
      <div class="prof-meta">${esc(b.category || "Business")}${b.neighborhood ? ` · ${esc(b.neighborhood)}` : ""} · ${esc(marketDisplayName(u.market))}<br>${b.about ? esc(b.about) : "No about yet. A written-up experience fills offers faster."}</div>
      <div class="prof-stats">
        <span class="ps"><b>${fmtNum(h.localReachDelivered || 0)}</b><span>local reach delivered</span></span>
        <span class="ps"><b>${h.postsLive || 0}</b><span>posts live</span></span>
        <span class="ps"><b>${reviews.length}</b><span>creator reviews</span></span>
        <span class="ps"><b>${esc(b.planName || "")}</b><span>plan</span></span>
      </div>
    </div></div>
    ${wsTabs([
      { label: "Profile", on: bizProfTab === "profile", onclick: "return bizProfSet('profile')" },
      { label: "Reviews", count: reviews.length, on: bizProfTab === "reviews", onclick: "return bizProfSet('reviews')" },
    ])}`;
    if (bizProfTab === "reviews") {
      el.innerHTML = head + (reviews.length ? `<div class="wcard">${reviews.map((r) => `<div class="lib-row"><div class="lib-main"><div class="lib-title">${starsHtml(r.stars)} ${esc(String(r.stars))} — ${esc(r.title || "Visit")}</div><div class="lib-meta">@${esc(r.handle || "")}${r.at ? ` · ${fmtDay(r.at)}` : ""}${r.text ? `<br>${esc(r.text)}` : ""}</div></div></div>`).join("")}</div>` : `<div class="empty-card"><div class="ec-t">No reviews yet</div><div class="ec-s">Reviews come from completed visits.</div></div>`);
    } else {
      el.innerHTML = head + `
      <div class="wcard">
        <h3>Your business profile</h3>
        <p class="wc-sub">What creators see when they weigh your offers: your name, category, neighborhood, and a short about.</p>
        <div class="form-2col">
          <div class="field"><label>Business name</label><input id="bp-name" value="${esc(b.businessName || "")}"></div>
          <div class="field"><label>Category</label>${chipSelectHtml("bp-category", state.boot.businessCategories.map((c) => ({ value: c, label: c })), b.category, null, false)}</div>
        </div>
        <div class="form-2col">
          <div class="field"><label>City</label><input id="bp-city" value="${esc(u.city || "")}"></div>
          <div class="field"><label>Neighborhood / area</label><input id="bp-neighborhood" value="${esc(b.neighborhood || "")}" placeholder="For example: Oceanfront, Ghent"></div>
        </div>
        <div class="field"><label>About your business</label><textarea id="bp-about" rows="3" placeholder="What you serve, what the visit feels like">${esc(b.about || "")}</textarea></div>
        <button class="btn ws-primary" onclick="saveBusinessProfile()">Save profile</button> <span id="bp-ok" class="saved"></span>
      </div>`;
    }
  } catch (err) {
    el.innerHTML = `${wsHead("Your business page")}<div class="error-box">${esc(err.message)}</div>`;
  }
}

// One-tap coaching fixes (the 48 hour nudge): raise the comp by
// $25, or widen the redemption window by 3 days. Both go through
// the same PATCH the composer uses, so the dignity floor and the
// window rules apply identically.
async function fixOffer(offerId, fix) {
  try {
    const data = await api("GET", "/offers");
    const o = (data.offers || []).find((x) => x.id === offerId);
    if (!o) { alert("That offer is no longer editable."); return; }
    if (fix === "raise") {
      await api("PATCH", `/offers/${offerId}`, o.kind === "paid" ? { cashRate: Number(o.cashRate) + 25 } : { dollarCap: Number(o.dollarCap) + 25 });
      alert("Comp raised by $25. Offers priced in the typical range for their tier fill first.");
    } else {
      const end = new Date(Date.parse(o.windowEndAt) + 3 * 24 * 3600 * 1000).toISOString();
      await api("PATCH", `/offers/${offerId}`, { windowEndAt: end });
      alert("Redemption window widened by 3 days.");
    }
    if (state.tab === "Home") loadBusinessHome(); else loadMyOffers();
  } catch (err) { alert(err.message); }
}

// One-tap rebook: the server prefills a direct offer from the
// last delivered visit with this creator; the composer opens on
// the new offer's list so the business can adjust before it is
// live... the offer is created open, matching "invite again"
// speed; the business can close it from My Offers any time.
async function rebookCreator(creatorId) {
  try {
    await api("POST", "/offers/rebook", { creatorId });
    state.tab = "My Offers";
    render();
    setTimeout(() => alert("Invite sent. It is prefilled from your last visit together and lives under My Offers."), 50);
  } catch (err) { alert(err.message); }
}

// Favorites view: the saved roster, favorites first-class. The
// heart on every discovery card toggles the same records.
async function loadFavorites() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/favorites");
    const favHead = `${wsHead("Find creators", { sub: "Your saved creators. One tap invites them again, prefilled from your last visit together.", subKey: "biz-discover" })}${wsTabs([
      { label: "Discover", on: false, onclick: "return go('dashboard','Discover')" },
      { label: "Favorites", on: true, onclick: "return go('dashboard','Favorites')" },
    ])}`;
    if (!data.favorites.length) {
      el.innerHTML = `${favHead}<div class="empty-card"><div class="ec-t">No favorites yet</div><div class="ec-s">Tap the heart on any creator while browsing Find creators and they are saved here: your standing roster for repeat visits.</div></div><p class="center"><button class="btn ws-primary" onclick="return go('dashboard','Discover')">Browse creators</button></p>`;
      return;
    }
    el.innerHTML = `${favHead}
    <div class="creator-grid">${data.favorites.map((c) => `<div>${creatorCard(c, state.user)}<button class="btn small-btn mt" style="width:100%" onclick="rebookCreator('${c.userId}')">Invite again</button></div>`).join("")}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function discoverCatChip(cat, btn) {
  const sel = document.getElementById("f-category");
  if (sel) sel.value = cat;
  document.querySelectorAll(".dcat-chip").forEach((b) => b.classList.toggle("on", b === btn));
  runDiscover();
  return false;
}

async function loadDiscover() {
  const el = document.getElementById("tab-body");
  const u = state.user;
  el.innerHTML = `
    ${wsHead("Find creators", { sub: "Flip through creators near you. Invite the ones who fit.", subKey: "biz-discover" })}
    ${wsTabs([
      { label: "Discover", on: true, onclick: "return go('dashboard','Discover')" },
      { label: "Favorites", on: false, onclick: "return go('dashboard','Favorites')" },
    ])}
    <div class="filters disc-top">
      <div><label>Market</label><select id="f-market">${marketOptions(u.market)}</select></div>
    </div>
    <div class="dcat-row">${[""].concat(state.boot.creatorCategories).map((c) => `<button type="button" class="dcat-chip${c === "" ? " on" : ""}" onclick="return discoverCatChip('${esc(c)}', this)">${c === "" ? "All" : esc(c)}</button>`).join("")}</div>
    <details class="filters-fold"><summary>More filters</summary>
    <div class="filters">
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
      <div><label>Sort by</label><select id="f-sort"><option value="">Founding order</option><option value="score">Local Impact Score</option><option value="momentum">Momentum (roster standing)</option><option value="fit">Best fit</option></select></div>
      <div><label>&nbsp;</label><label style="font-weight:500"><input type="checkbox" id="f-paid" style="width:auto"> Has a paid rate (paid bookings) only</label></div>
      <div><label>&nbsp;</label><button class="btn small-btn" style="width:100%" onclick="runDiscover()">Search</button></div>
    </div>
    </details>
    <div id="discover-toggle"></div>
    <div id="discover-results">${skelHtml("Loading creators...", 2)}</div>`;
  runDiscover();
}

async function runDiscover() {
  await ensureDeckState();
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
      el.innerHTML = `<div class="empty-state"><span class="es-badge"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg></span><h3>No approved creators match yet</h3><p>SIGNL is building the founding roster in this market now. Creators who sign up and get approved will appear here automatically.</p></div>`;
      return;
    }
    const tg = document.getElementById("discover-toggle");
    if (tg) tg.innerHTML = discoverModeToggleHtml();
    renderDiscoverResults();
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// ---------- V5: Discover as a card stack (Jeff, 2026-10-25) ----------
// Tinder-feel browsing over the SAME results, eligibility and
// actions: Invite is startOffer (the existing direct-offer flow),
// tap opens the existing profile view, a pass parks the creator
// in the business's Later pile. Cards is the default; List renders
// the exact card grid Discover has always rendered.
function discoverModeToggleHtml() {
  const mode = state.discoverMode || "cards";
  return `<div class="view-toggle"><div class="vt-group"><button type="button" class="rchip${mode === "cards" ? " on" : ""}" onclick="setDiscoverMode('cards')">Cards</button><button type="button" class="rchip${mode === "list" ? " on" : ""}" onclick="setDiscoverMode('list')">List</button></div>${deckChromeHtml("discover")}<span class="stack-pos" data-stackpos="discover"></span></div>${deckTeachHtml("discover")}`;
}
function setDiscoverMode(mode) {
  state.discoverMode = mode;
  const tg = document.getElementById("discover-toggle");
  if (tg) tg.innerHTML = discoverModeToggleHtml();
  renderDiscoverResults();
  return false;
}
function renderDiscoverResults() {
  const el = document.getElementById("discover-results");
  if (!el) return;
  const all = state.discover || [];
  if (!all.length) return; // runDiscover already rendered the empty state
  const q = deckQueue("discover", all);
  if (!q.visible.length) {
    const pos = document.querySelector('[data-stackpos="discover"]');
    if (pos) pos.textContent = "";
    el.innerHTML = `<div class="stk-end"><h3>Nothing new in this search</h3><p class="small muted">Everyone here is parked in your Later pile or hidden.</p><div class="stk-end-actions">${q.parked.length ? `<button type="button" class="btn ghost" onclick="openLaterPile('discover')">Review Later (${q.parked.length})</button>` : ""}<button type="button" class="btn" onclick="discoverClearFilters()">Clear filters</button></div></div>`;
    syncDeckChrome("discover");
    return;
  }
  if ((state.discoverMode || "cards") === "list") {
    const pos = document.querySelector('[data-stackpos="discover"]');
    if (pos) pos.textContent = "";
    el.innerHTML = `<div class="creator-grid vx-stagger">${q.visible.map((c) => creatorCard(c, state.user)).join("")}</div>`;
    syncDeckChrome("discover");
    return;
  }
  if (!stackState.discover || stackState.discover.src !== all) {
    stackState.discover = startDeck("discover", all, {
      cardHtml: (c) => discoverStackCard(c),
      goLabel: "Invite",
      onGo: (c) => { pileUnlater("discover", c.userId); startOffer(c.userId); },
      onPass: (c) => { pileLater("discover", c.userId); },
      onTap: (c) => { openCreatorProfile(c.userId); },
      endHtml: (passed, total) => discoverEndHtml(passed, total),
    });
  }
  el.innerHTML = `<div class="stk-wrap" data-stack="discover"></div>`;
  renderStack(el.firstElementChild);
  syncDeckChrome("discover");
}
function discoverStackCard(c) {
  const p = c.profile || {};
  const initial = esc((c.name || "?").trim().charAt(0).toUpperCase() || "?");
  const cats = (p.categories || []).slice(0, 3);
  const extra = (p.categories || []).length - cats.length;
  const place = [c.neighborhood, c.city].filter(Boolean).map(esc).join(" &middot; ");
  const rateLine = p.compOpen === false ? "Paid visits only" : (p.paidRate ? `Listed rate $${fmtPrice(p.paidRate)}` : "Comp friendly");
  return `<div class="dcard${c.standing === "paused" ? " paused" : ""}">
    <div class="dcard-photo${c.photoUrl ? "" : " no-photo"}">
      ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : `<div class="dcard-mono"><span>${initial}</span></div>`}
      ${p.tierBand ? `<span class="dcard-tier">${esc(p.tierBand)}</span>` : ""}
      ${c.previewPhoto ? `<span class="dcard-sample">Sample photo · preview</span>` : ""}
    </div>
    <div class="dcard-body">
      <div class="dcard-name">${esc(c.name)}</div>
      <div class="dcard-handle">@${esc(p.handle || "")}</div>
      <div class="dcard-local">${p.localAudiencePct === null || p.localAudiencePct === undefined
        ? `<span class="dcard-local-na">Local reach not reported yet</span>`
        : `<span class="dcard-pct">${p.localAudiencePct}%</span><span class="dcard-local-lbl">local reach</span>`}</div>
      ${cats.length ? `<div class="dcard-chips">${cats.map((x) => `<span class="cc-chip">${esc(x)}</span>`).join("")}${extra > 0 ? `<span class="cc-chip">+${extra}</span>` : ""}</div>` : ""}
      <div class="dcard-meta"><span>${rateLine}</span>${place ? `<span>${place}</span>` : ""}<span>${fmtNum(totalAudienceOf(c))} audience</span></div>
      ${c.bookedUp ? `<p class="small muted" style="margin:8px 0 0">Booked up this week — invites still land, accepting reopens next week.</p>` : ""}
      ${c.standing === "paused" ? `<p class="small muted" style="margin:8px 0 0">Paused: a late post is outstanding, so this creator cannot take new offers yet.</p>` : ""}
    </div>
  </div>`;
}
function discoverEndHtml(passed, total) {
  const q = deckQueue("discover", (stackState.discover && stackState.discover.src) || []);
  const n = q.parked.length;
  const seen = q.visible.length;
  return `<div class="stk-end"><h3>You have seen everyone near you for now</h3><p class="small muted">Your Later pile is below, and new creators in ${esc(marketTalkNameClient(state.user.market))} show up here first. You looked through ${seen} creator${seen === 1 ? "" : "s"} in this search.</p><div class="stk-end-actions">${n ? `<button type="button" class="btn ghost" onclick="openLaterPile('discover')">Review Later (${n})</button>` : ""}<button type="button" class="btn" onclick="discoverClearFilters()">Clear filters</button></div></div>`;
}
function discoverClearFilters() {
  ["f-neighborhood", "f-q", "f-fmin", "f-fmax", "f-minlocal"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  ["f-tier", "f-category", "f-comp", "f-sort"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  const paid = document.getElementById("f-paid");
  if (paid) paid.checked = false;
  const mkt = document.getElementById("f-market");
  if (mkt && state.user) mkt.value = state.user.market;
  runDiscover();
  return false;
}

async function toggleFav(creatorId) {
  try {
    await api("POST", "/favorites", { creatorId });
    if (state.tab === "Favorites") loadFavorites();
    else if (state.tab === "Discover" || !state.tab) runDiscover();
    else render();
  } catch (err) { alert(err.message); }
}

function goApplicants(offerId) {
  // V3: applicants live in the Offers screen's Applicants
  // segment, filtered to the offer when one is named.
  state.offersSeg = "applicants";
  if (offerId) {
    if (!reqState) reqState = reqFreshState();
    reqState.offerId = offerId;
    reqState.loaded = false;
  }
  state.tab = "My Offers";
  render();
  return false;
}

// Offers segments (spec §5.2): Live / Applicants / Past over
// one screen. Live carries the list, templates and composer;
// Applicants is the Requests workspace; Past is read-only
// except Duplicate.
function renderOffersSegTabs() {
  const host = document.getElementById("offers-segs");
  if (!host) return;
  const all = state.myOffers || [];
  const wc = state.waitCounts || {};
  host.innerHTML = wsTabs([
    { label: "Live", count: all.filter((o) => !offerIsArchived(o)).length || null, on: state.offersSeg === "live", onclick: "return offersSetSeg('live')" },
    { label: "Applicants", count: wc.bizApps || null, on: state.offersSeg === "applicants", onclick: "return offersSetSeg('applicants')" },
    { label: "Past", count: all.filter(offerIsArchived).length || null, on: state.offersSeg === "past", onclick: "return offersSetSeg('past')" },
  ]);
}
function offersSetSeg(seg) {
  state.offersSeg = seg;
  loadMyOffers();
  return false;
}
function offersNew() {
  const c = document.getElementById("offer-composer");
  if (c) c.scrollIntoView({ behavior: "smooth" });
  return false;
}
// Duplicate: the one write allowed from Past — the composer
// opens pre-filled from the old offer.
function duplicateOffer(offerId) {
  const o = (state.myOffers || []).find((x) => x.id === offerId);
  if (!o) return false;
  state.offerTarget = null;
  state.composerLane = "open";
  state.offerDraft = {
    title: o.title || "", comped: o.whatComped || "", cap: o.dollarCap != null ? String(o.dollarCap) : "",
    rate: o.cashRate != null ? String(o.cashRate) : "", kind: o.kind || "comp", brief: o.paidBrief || "",
    includes: o.includes || "", experience: o.experience || "", tiers: o.targetTiers || [],
    spots: o.spots != null ? String(o.spots) : "", applydays: o.applyWindowDays != null ? String(o.applyWindowDays) : "",
    windowdays: o.windowDays != null ? String(o.windowDays) : "", window: o.visitWindow || "",
    covers: o.covers != null ? String(o.covers) : "",
  };
  state.offersSeg = "live";
  state.tab = "My Offers";
  render();
  setTimeout(() => { const c = document.getElementById("offer-composer"); if (c) c.scrollIntoView({ behavior: "smooth" }); }, 60);
  return false;
}

// Two-tap invite (Jeff, 2026-10-26): the homepage promises a
// business can invite in two taps, so the DIRECT composer must
// open submittable: on a FRESH draft, prefill the title with the
// tier's lead comp suggestion and preselect that suggestion (its
// comped text + cap), on top of the lane defaults that already
// hold (kind comp, window 7 days, spots 1). Tap 1 = Invite on the
// card, tap 2 = Send. Everything stays editable before sending.
// A draft with anything typed in it is the business's own work
// and is NEVER overwritten: prefill only fires on an empty draft.
function offerDraftIsEmpty() {
  const d = state.offerDraft || {};
  return !["title", "comped", "cap", "rate", "brief", "includes", "experience", "spots", "window", "windowdays", "applydays"].some((k) => d[k] !== undefined && d[k] !== null && String(d[k]).trim() !== "");
}

function prefillDirectDraft(creator) {
  if (!creator || !offerDraftIsEmpty()) return false;
  const s = compSuggestions(creator.profile ? creator.profile.tierBand : null)[0];
  if (!s) return false;
  state.offerDraft.title = s.label;
  state.offerDraft.comped = s.comp;
  state.offerDraft.cap = String(s.cap);
  state.offerDraft.kind = "comp";
  return true;
}

function startOffer(creatorId) {
  pileUnlater("discover", creatorId);
  state.tab = "My Offers";
  state.offerTarget = creatorId;
  prefillDirectDraft((state.discover || []).find((x) => x.userId === creatorId));
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
function chipsRowHtml(kind, prefix, tierBand, current) {
  if (kind === "comp") {
    return `<div class="chip-row">${compSuggestions(tierBand).map((s) => `<button type="button" class="chip${current && current.comp === s.comp && Number(current.cap) === s.cap ? " on" : ""}" data-compchip="${prefix}" data-comp="${esc(s.comp)}" data-cap="${s.cap}" onclick="setCompChip('${prefix}', ${JSON.stringify(s.comp)}, ${s.cap})">${esc(s.label)} (~$${fmtPrice(s.cap)})</button>`).join("")}</div>`;
  }
  return `<div class="chip-row"><button type="button" class="chip" onclick="setWindowMode('${prefix}', '7days')">Use within 7 days</button><button type="button" class="chip" onclick="setWindowMode('${prefix}', 'thisweek')">This week (ends Sunday)</button></div>`;
}

function setCompChip(prefix, comp, cap) {
  const c = document.getElementById(prefix + "-comped");
  const k = document.getElementById(prefix + "-cap");
  if (c) c.value = comp;
  if (k) k.value = cap;
  document.querySelectorAll(`[data-compchip="${prefix}"]`).forEach((b) => b.classList.toggle("on", b.dataset.comp === comp && Number(b.dataset.cap) === Number(cap)));
  if (prefix === "o2") offerCoachUpdate();
}

function setWindowMode(prefix, mode) {
  const el = document.getElementById(prefix + "-windowmode");
  if (el) el.value = mode;
  // V4: the mode is a chip group over the hidden input — keep the
  // highlighted chip in step with the value.
  document.querySelectorAll(`[data-wm^="${prefix}:"]`).forEach((b) => b.classList.toggle("on", b.getAttribute("data-wm") === prefix + ":" + mode));
  if (prefix === "o2") offerDraftSync();
}

function windowModeFieldHtml(prefix, selected) {
  const sel = selected === "thisweek" ? "thisweek" : "7days";
  return `<div class="field"><label>Redemption window</label><div class="chiprow" data-wmrow="${prefix}"><button type="button" class="rchip${sel === "7days" ? " on" : ""}" data-wm="${prefix}:7days" onclick="setWindowMode('${prefix}', '7days')">Use within 7 days</button><button type="button" class="rchip${sel === "thisweek" ? " on" : ""}" data-wm="${prefix}:thisweek" onclick="setWindowMode('${prefix}', 'thisweek')">This week (ends Sunday)</button></div><input type="hidden" id="${prefix}-windowmode" value="${sel}"></div>`;
}

function packageSummaryHtml(planId, planName) {
  const comp = rightsForVisit("comp");
  return `<div class="pkg-mint"><h4>The Standard Visit — every comped offer</h4>
    ${standardVisitRowsHtml()}
    <details class="deal-details"><summary>The Standard Visit, in full</summary><div class="dd-body">
      <p class="small">${esc(standardVisit().summary)}</p>
      <p class="small"><strong>On a comp visit, you can:</strong> ${comp.can.map(esc).join("; ")}. They can't: ${comp.cannot.map(esc).join("; ")}. <strong>On a paid visit, you can also</strong> repost the post on your own feed and run it as an ad for 90 days from the post date. A comped post can be licensed for the same 90 days at the creator's listed licensing fee, with their approval. Rights follow the visit, not your plan${planName ? ` (${esc(planName)})` : ""}.</p>
    </div></details>
    <p class="small" style="margin:12px 0 0;font-weight:700">Meal-for-two comps outperform solo.</p>
  </div>`;
}

// ---------- offer composer v2 (Jeff, 2026-10-20) ----------
// Two lanes: the comp package is locked (the Standard Visit); paid
// bookings negotiate deliverables in their terms. DIRECT invites one creator (the
// target picked in Discover). OPEN posts terms to the market and
// creators apply with one tap. The composer coaches live: tier
// comp guidance, the dignity floor, a four-point strength
// checklist, and play templates. The server enforces the same
// numbers from bootstrap.offerGuidance, so the coaching here and
// the rules there can never drift apart.
function offerGuidance() { return (state.boot && state.boot.offerGuidance) || { compGuidance: {}, templates: [], paidFloor: 50, selectionSlaHours: 72, backfillAcceptHours: 24 }; }

function composerMode() {
  if (state.offerTarget) return "direct";
  return state.composerLane || "open";
}

function setComposerLane(lane) {
  offerDraftSync();
  state.composerLane = lane;
  state.offerTarget = null;
  loadMyOffers();
}

function applyTemplate(id) {
  const t = (offerGuidance().templates || []).find((x) => x.id === id);
  if (!t) return;
  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v; };
  set("o2-title", t.title);
  set("o2-spots", t.spots);
  set("o2-windowdays", t.windowDays);
  set("o2-window", t.note);
  const hidden = document.getElementById("o2-template");
  if (hidden) hidden.value = id;
  offerCoachUpdate();
}

// The live coaching: strength checklist + dignity floor warning,
// recomputed on every keystroke from the same guidance the
// server enforces.
// ---------- offer composer support (UX redesign section 5) ----------
// The composer keeps its state in state.offerDraft: every input
// writes through on input/change, the render initializes FROM the
// draft, and loadMyOffers re-renders therefore never eat typed text.
function offerDraftSync() {
  if (!document.getElementById("o2-title")) return;
  const d = state.offerDraft;
  const set = (key, id) => { const el = document.getElementById(id); if (el) d[key] = el.value; };
  set("title", "o2-title"); set("comped", "o2-comped"); set("cap", "o2-cap"); set("rate", "o2-rate");
  set("brief", "o2-brief"); set("includes", "o2-includes"); set("experience", "o2-experience");
  set("spots", "o2-spots"); set("applydays", "o2-applydays"); set("windowdays", "o2-windowdays");
  set("window", "o2-window"); set("windowmode", "o2-windowmode"); set("template", "o2-template");
  const kind = (document.querySelector("input[name='o2-kind']:checked") || {}).value;
  if (kind) d.kind = kind;
  const covers = (document.querySelector("input[name='o2-covers']:checked") || {}).value;
  if (covers) d.covers = covers;
  if (document.querySelector("input[name='o2-tier']")) d.tiers = [...document.querySelectorAll("input[name='o2-tier']:checked")].map((x) => x.value);
}

// Per-field inline validation: the error lands in a
// <p class="field-err"> under the field; the top #form-error is
// reserved for server errors and the dedupe notice.
function offerFieldError(key, msg) {
  const el = document.getElementById("err-o2-" + key);
  if (el) el.textContent = msg || "";
  return !msg;
}

function offerValidateField(key) {
  offerDraftSync();
  const d = state.offerDraft;
  const kind = d.kind || "comp";
  if (key === "title") return offerFieldError("title", !String(d.title || "").trim() ? "Give the offer a title." : "");
  if (key === "comped") return offerFieldError("comped", !String(d.comped || "").trim() ? "Say exactly what is comped." : "");
  if (key === "cap") return kind === "paid" ? offerFieldError("cap", "") : offerFieldError("cap", !(Number(d.cap) > 0) ? "Enter the comp value in dollars." : "");
  if (key === "rate") return kind !== "paid" ? offerFieldError("rate", "") : offerFieldError("rate", !(Number(d.rate) >= 50) ? "Enter the cash rate. Cash offers start at $50." : "");
  if (key === "spots") {
    const v = String(d.spots === undefined ? "" : d.spots).trim();
    if (v === "") return offerFieldError("spots", "");
    return offerFieldError("spots", !(parseInt(v, 10) > 0) ? "Spots must be at least 1." : "");
  }
  return true;
}

const OFFER_INFO = {
  lane: { title: "Open or direct", body: "An open offer posts your terms to your market and creators apply. A direct offer goes to one creator you pick in Discover, and only they see it." },
  templates: { title: "Templates", body: "Templates prefill a proven offer shape: title, spots, window, and a note. Edit anything after picking one. On a comp offer the deliverable never changes: the Standard Visit. On a cash offer, the booking terms set the deliverables." },
  title: { title: "Offer title", body: "Name the experience, not the deal. For example: Dinner for two on us. Creators scan titles first, so say what they get." },
  kind: { title: "How the creator is paid", body: "Comp means your product is the payment: the meal, service, or experience is on you, and the deliverable is the Standard Visit. Cash means you pay the creator a rate for a booking whose deliverables the booking terms set. Pick one; an offer is never both." },
  comped: { title: "What is comped", body: "Say exactly what the creator gets, in one line. For example: Two entrees and two drinks. This line prints on the offer, the visit card, and the staff screen." },
  covers: { title: "Who the comp covers", body: "One person is just the creator. Two people adds a guest. Creators post more when they can bring a guest, and meal for two comps outperform solo comps." },
  cap: { title: "Comp value / dollar cap", body: "The most the comp can ring up, at menu value. For example: a $100 cap on a dinner for two. Higher caps inside the typical range for a tier fill first." },
  rate: { title: "Cash rate", body: "What you pay the creator for one paid booking. The business pays the rate plus 3%. The creator keeps 97%. Minimum listed rate $50." },
  brief: { title: "Key points", body: "Short direction for a paid visit: what to feature, names, dates. Creators post honestly in their own words. No scripts, no required praise, no post pre-approval." },
  includes: { title: "What is included", body: "Any two entrees, two drinks each, dessert to share, tax and tip covered. Creators weigh this detail most: say exactly what they get." },
  experience: { title: "The experience", body: "What it feels like and what photographs well. For example: chef's counter seats, open kitchen, the tasting menu everyone photographs." },
  tiers: { title: "Who can apply", body: "Tiers are set automatically by audience size: Neighbors, Locals, Headliners. Ticking tiers only narrows who may apply. Leave all unticked and every tier your comp fits can apply." },
  spots: { title: "Spots", body: "How many creators you will pick from the applicants. Each picked creator books one visit." },
  applydays: { title: "Applications open for", body: "How many days creators can apply before you pick. Three days is the usual: long enough to build a stack, short enough to keep momentum." },
  windowdays: { title: "Redemption window", body: "How many days picked creators have to come in, starting when applications close. Seven days is the usual. Windows of 3 or more days fill best." },
  windownote: { title: "Window note", body: "Anything that helps the creator time the visit. For example: Evenings are best. The note prints on the offer and the visit card." },
};

function infoBtn(topic) {
  return `<button type="button" class="info-btn" aria-label="About this field" onclick="showOfferInfo('${topic}')">i</button>`;
}

function showOfferInfo(topic) {
  const info = OFFER_INFO[topic];
  const pop = document.getElementById("offer-info-pop");
  if (!info || !pop) return false;
  document.getElementById("offer-info-title").textContent = info.title;
  document.getElementById("offer-info-body").textContent = info.body;
  pop.style.display = "";
  return false;
}

function closeOfferInfo() {
  const pop = document.getElementById("offer-info-pop");
  if (pop) pop.style.display = "none";
  return false;
}

function jumpToOffer(offerId) {
  const card = document.getElementById("offer-card-" + offerId);
  if (!card) return false;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("highlight");
  setTimeout(() => card.classList.remove("highlight"), 2400);
  return false;
}

function offerCoachUpdate() {
  offerDraftSync();
  const g = offerGuidance();
  const kind = (document.querySelector("input[name='o2-kind']:checked") || {}).value || "comp";
  const cap = parseInt((document.getElementById("o2-cap") || {}).value, 10) || 0;
  const rate = parseFloat((document.getElementById("o2-rate") || {}).value) || 0;
  const wdEl = document.getElementById("o2-windowdays");
  const windowDays = wdEl ? (wdEl.value === "" ? 7 : parseInt(wdEl.value, 10) || 0) : 7;
  const includes = ((document.getElementById("o2-includes") || {}).value || "").trim();
  const experience = ((document.getElementById("o2-experience") || {}).value || "").trim();
  const tiers = [...document.querySelectorAll("input[name='o2-tier']:checked")].map((x) => x.value);
  const checks = [
    { label: kind === "paid" ? `Cash rate stated (floor $${fmtPrice(g.paidFloor)})` : "Comp value stated", ok: kind === "paid" ? rate >= g.paidFloor : cap > 0 },
    { label: "Redemption window is 3+ days", ok: windowDays >= 3 },
    { label: "What is included is written out", ok: includes.length >= 12 },
    { label: "The experience is described", ok: experience.length >= 12 },
  ];
  const el = document.getElementById("o2-strength");
  const doneCount = checks.filter((c) => c.ok).length;
  const nextCheck = checks.find((c) => !c.ok);
  if (el) el.innerHTML = `<strong>Offer checklist: ${doneCount} of ${checks.length}</strong>` + (nextCheck ? `<br>Next: ${esc(nextCheck.label)}` : `<br>Complete: ready to publish.`) + checks.map((c) => `<br>${c.ok ? "&#10003;" : "&#9675;"} ${esc(c.label)}`).join("");
  // Payment switch (UX redesign section 5): comp shows the cap
  // group, paid shows the rate group plus the brief. What is
  // comped and covers stay visible for both kinds.
  const briefWrap = document.getElementById("o2-brief-wrap");
  if (briefWrap) briefWrap.style.display = kind === "paid" ? "" : "none";
  const capWrap = document.getElementById("o2-cap-wrap");
  if (capWrap) capWrap.style.display = kind === "paid" ? "none" : "";
  const rateWrap = document.getElementById("o2-rate-wrap");
  if (rateWrap) rateWrap.style.display = kind === "paid" ? "" : "none";
  const warn = document.getElementById("o2-dignity");
  if (warn) {
    let html = "";
    if (kind === "comp" && composerMode() === "open") {
      const blocked = tiers.filter((t) => g.compGuidance[t] && cap > 0 && cap < g.compGuidance[t].floor);
      if (blocked.length) {
        html = `<div class="error-box">A $${fmtMoney(cap)} comp is below the dignity floor for ${blocked.map(esc).join(", ")} (floors: ${blocked.map((t) => `${esc(t)} $${fmtPrice(g.compGuidance[t].floor)}`).join(", ")}). Raise the value or untick ${blocked.length === 1 ? "that tier" : "those tiers"}: token comps burn the roster's trust, so SIGNL will not publish this as is.</div>`;
      } else if (cap > 0 && tiers.length) {
        const fits = tiers.filter((t) => g.compGuidance[t] && cap >= g.compGuidance[t].typicalLow && cap <= g.compGuidance[t].typicalHigh);
        html = `<p class="small muted">$${fmtMoney(cap)} sits in the typical range for ${fits.length ? fits.map(esc).join(", ") : "none of the ticked tiers, which usually means slower applications"}.</p>`;
      } else if (cap > 0 && cap < 25) {
        html = `<div class="error-box">Comp offers start at $25 of value. Below that it is a token, and token comps burn the roster's trust.</div>`;
      }
    }
    if (kind === "paid") {
      const total = Math.round(rate * 1.03 * 100) / 100;
      const net = Math.round(rate * 0.97 * 100) / 100;
      html = rate > 0 ? `<p class="small muted">At $${fmtPrice(rate)}: you pay $${fmtMoney(total)} (rate + 3%), the creator keeps $${fmtMoney(net)} (97%), and SIGNL holds the payment until the post is live. Below $${fmtPrice(g.paidFloor)} a cash offer cannot run.</p>` : "";
    }
    warn.innerHTML = html;
  }
  // V5: keep the drag bars painted in step with the values
  // (template picks and chip fills write inputs directly).
  dragInit();
}

async function loadMyOffers() {
  const el = document.getElementById("tab-body");
  if (state.offerTarget) state.offersSeg = "live";
  if (!state.offersSeg) {
    // Default segment (spec §5.2): Applicants when anyone is
    // waiting, else Live. Decided from the same records the
    // tab badge counts, so the three never disagree.
    el.innerHTML = `${wsHead("Offers", { sub: "Your offers, and the creators who applied to them.", subKey: "biz-offers" })}${skelHtml("Loading your offers...", 2)}`;
    state.offersSeg = "live";
    try {
      const od = await api("GET", "/offers");
      state.myOffers = od.offers || [];
      let waitingCount = 0;
      for (const o of state.myOffers.filter((x) => (x.applicationCount || 0) > 0).slice(0, 12)) {
        const ad = await api("GET", `/offers/${o.id}/applications`);
        waitingCount += (ad.applications || []).filter((a) => a.status === "applied").length;
      }
      state.waitCounts = state.waitCounts || {};
      state.waitCounts.bizApps = waitingCount;
      if (waitingCount > 0) state.offersSeg = "applicants";
    } catch (e) { /* the Live default stands */ }
    if (!document.getElementById("tab-body")) return;
    return loadMyOffers();
  }
  if (state.offersSeg === "applicants") {
    el.innerHTML = `${wsHead("Offers", { sub: "Your offers, and the creators who applied to them.", subKey: "biz-offers" })}<div id="offers-segs"></div><div id="offers-seg-body"></div>`;
    renderOffersSegTabs();
    renderRequestsTab(true);
    return;
  }
  bizOfferTab = state.offersSeg === "past" ? "archived" : "current";
  const target = state.offerTarget ? (state.discover || []).find((c) => c.userId === state.offerTarget) : null;
  const mode = target ? "direct" : composerMode();
  const g = offerGuidance();
  const myPlan = state.user && state.user.business ? state.user.business.plan : null;
  const planObj = (state.boot ? state.boot.plans : []).find((p) => p.id === myPlan);
  const marketLive = !!(state.boot && state.boot.launch && state.boot.launch.marketLive && state.boot.launch.marketLive[state.user.market]);
  const dft = state.offerDraft || {};
  const dv = (v) => esc(v === undefined || v === null ? "" : String(v));
  // V5 (Jeff, 2026-10-25): "Who can apply" is three Slotted lane
  // toggle rows — switch + bold tier + one muted floor/typical
  // line. The checkbox keeps its name, value, default and
  // onchange; only its face changed (same swap as V4's toggles).
  const tierBoxes = `<div class="tier-toggles">${["Neighbors", "Locals", "Headliners"].map((t) => {
    const gd = g.compGuidance[t] || {};
    return `<label class="tier-toggle"><input type="checkbox" class="sw" name="o2-tier" value="${esc(t)}" ${(dft.tiers || []).includes(t) ? "checked" : ""} onchange="offerCoachUpdate()"><span class="tt-body"><span class="tt-name">${esc(t)}</span><span class="tt-line">floor $${fmtPrice(gd.floor)} &middot; typ. $${fmtPrice(gd.typicalLow)}&ndash;$${fmtPrice(gd.typicalHigh)}</span></span></label>`;
  }).join("")}</div>`;
  el.innerHTML = `
  ${wsHead("Offers", { sub: "Your offers, and the creators who applied to them.", subKey: "biz-offers", action: state.offersSeg === "live" ? `<button type="button" class="btn ws-primary" onclick="return offersNew()">+ New offer</button>` : "" })}
  <div id="offers-segs"></div>
  <div id="offer-list">${skelHtml("Loading your offers...", 2)}</div>
  <div id="offers-live-only">
  <h3 style="margin:24px 0 0">Templates</h3>
  ${bizTemplatesHtml()}
  <div class="panel" id="offer-composer" style="margin-top:18px">
    <h3 style="margin-top:0">Create an offer</h3>
    <div id="form-error"></div>
    ${packageSummaryHtml(myPlan, planObj ? planObj.name : null)}
    <div class="field"><label>Who sees this offer ${infoBtn("lane")}</label>
    <div class="chip-row" role="tablist">
      <button type="button" class="chip ${mode === "open" ? "on" : ""}" onclick="setComposerLane('open')">Open offer</button>
      <button type="button" class="chip ${mode === "direct" ? "on" : ""}" onclick="setComposerLane('direct')">Direct offer</button>
    </div>
    <p class="small muted" style="margin-top:6px">${mode === "open" ? "Any creator who fits can apply. You pick." : "Only the creator you pick sees this offer."}</p>
    </div>
    ${mode === "direct" && !target ? `<p class="small muted">Pick the creator in Discover and tap Send offer, or <a href="#" onclick="setComposerLane('open'); return false;">post an open offer</a> and let creators apply.</p>` : ""}
    ${mode === "direct" && target ? `<div class="notice blue">Sending directly to <strong>${esc(target.name)}</strong> (@${esc(target.profile.handle)}), ${esc(target.profile.tierBand || "")} tier. <a href="#" onclick="state.offerTarget=null; loadMyOffers(); return false;">Make it an open offer instead</a></div>` : ""}
    ${mode === "open" ? `
    <p class="small muted" style="margin-bottom:4px">Start from a template (optional) ${infoBtn("templates")}</p>
    <div class="chip-row">${(g.templates || []).map((t) => `<button type="button" class="chip" onclick="applyTemplate('${esc(t.id)}')">${esc(t.label)}</button>`).join("")}</div>` : ""}
    <form onsubmit="return createOfferV2(event)">
      <input type="hidden" id="o2-template" value="${dv(dft.template)}">
      <div class="fgroup tint">
      <p class="fg-kicker">The offer</p>
      <div class="field"><label>Offer title <span class="req-tag">Required</span> ${infoBtn("title")}</label><input id="o2-title" value="${dv(dft.title)}" placeholder="Dinner for two on us" oninput="offerDraftSync()" onblur="offerValidateField('title')"><p class="field-err" id="err-o2-title"></p></div>
      <div class="field"><label>How is the creator paid? <span class="req-tag">Required</span> ${infoBtn("kind")}</label>
        <div class="radio-stack">
        <label class="radio-chip"><input type="radio" name="o2-kind" value="comp" ${dft.kind === "paid" ? "" : "checked"} onchange="offerCoachUpdate()"><span>Comp: your product, on you</span></label>
        <label class="radio-chip"><input type="radio" name="o2-kind" value="paid" ${dft.kind === "paid" ? "checked" : ""} onchange="offerCoachUpdate()"><span>Cash: a rate for a paid booking</span></label>
        </div>
      </div>
      <div class="field"><label>Exactly what is comped <span class="req-tag">Required</span> ${infoBtn("comped")}</label><input id="o2-comped" value="${dv(dft.comped)}" placeholder="Two entrees and two drinks" oninput="offerCoachUpdate()" onblur="offerValidateField('comped')"><p class="field-err" id="err-o2-comped"></p>${mode === "direct" ? chipsRowHtml("comp", "o2", target && target.profile ? target.profile.tierBand : null, { comp: dft.comped, cap: dft.cap }) : ""}</div>
      <div class="field" id="o2-covers-wrap"><label>How many people does the comp cover? <span class="req-tag">Required</span> ${infoBtn("covers")}</label>
        <div class="radio-stack">
        <label class="radio-chip"><input type="radio" name="o2-covers" value="1" ${dft.covers === "2" ? "" : "checked"} onchange="offerDraftSync()"><span>1 person: just the creator</span></label>
        <label class="radio-chip"><input type="radio" name="o2-covers" value="2" ${dft.covers === "2" ? "checked" : ""} onchange="offerDraftSync()"><span>2 people: the creator and a guest</span></label>
        </div>
        <p class="small muted">Prints on the offer, the visit card and the staff screen.</p>
      </div>
      <div class="field" id="o2-brief-wrap" style="display:none"><label>Key points for the creator <span class="opt-tag">Optional</span> ${infoBtn("brief")}</label><textarea id="o2-brief" rows="2" maxlength="500" placeholder="Feature the new patio, use our full name" oninput="offerDraftSync()">${esc(dft.brief || "")}</textarea><p class="small muted">${PAID_BRIEF_GUIDANCE}</p></div>
      </div>
      <div class="fgroup">
      <p class="fg-kicker">The value</p>
      <div class="form-2col">
        <div class="field" id="o2-cap-wrap"><label>Comp value / dollar cap ($) <span class="req-tag">Required</span> ${infoBtn("cap")}</label><input type="number" id="o2-cap" min="1" placeholder="100" value="${dv(dft.cap)}" oninput="offerCoachUpdate()" onblur="offerValidateField('cap')"><p class="field-err" id="err-o2-cap"></p></div>
        <div class="field" id="o2-rate-wrap" style="display:none"><label>Cash rate ($) <span class="req-tag">Required</span> ${infoBtn("rate")}</label><input type="number" id="o2-rate" min="50" step="1" placeholder="150" value="${dv(dft.rate)}" oninput="offerCoachUpdate()" onblur="offerValidateField('rate')"><p class="field-err" id="err-o2-rate"></p><p class="small muted">You pay rate + 3%. Creator keeps 97%. Min $50.</p></div>
      </div>
      <div class="field"><label>What is included <span class="opt-tag">Optional</span> ${infoBtn("includes")}</label><textarea id="o2-includes" rows="2" placeholder="Any two entrees, two drinks each, dessert to share" oninput="offerCoachUpdate()">${esc(dft.includes || "")}</textarea></div>
      <div class="field"><label>The experience <span class="opt-tag">Optional</span> ${infoBtn("experience")}</label><textarea id="o2-experience" rows="2" placeholder="Chef's counter seats, open kitchen" oninput="offerCoachUpdate()">${esc(dft.experience || "")}</textarea></div>
      </div>
      ${mode === "open" ? `
      <div class="fgroup tint">
      <p class="fg-kicker">Who + when</p>
      <div class="field"><label>Who can apply <span class="opt-tag">Optional</span> ${infoBtn("tiers")}</label>${tierBoxes}</div>
      <div class="form-2col">
        <div class="field"><label>Spots (creators you will pick) <span class="req-tag">Required</span> ${infoBtn("spots")}</label>${dragBarHtml("o2-spots", 1, 30, `placeholder="1" value="${dv(dft.spots)}" oninput="offerDraftSync()" onblur="offerValidateField('spots')"`)}<p class="field-err" id="err-o2-spots"></p></div>
        <div class="field"><label>Applications open for (days) <span class="opt-tag">Optional</span> ${infoBtn("applydays")}</label>${dragBarHtml("o2-applydays", 1, 14, `placeholder="3" value="${dv(dft.applydays)}" oninput="offerDraftSync()"`)}</div>
      </div>
      <div class="form-2col">
        <div class="field"><label>Redemption window (days, starts when applications close) <span class="opt-tag">Optional</span> ${infoBtn("windowdays")}</label>${dragBarHtml("o2-windowdays", 1, 30, `placeholder="7" value="${dv(dft.windowdays)}" oninput="offerCoachUpdate()"`)}</div>
        <div class="field"><label>Window note for creators <span class="opt-tag">Optional</span> ${infoBtn("windownote")}</label><input id="o2-window" value="${dv(dft.window)}" placeholder="Evenings are best" oninput="offerDraftSync()"></div>
      </div>
      <p class="small muted">You get ${g.selectionSlaHours} hours to pick after applications close. Everyone else is released with a notification.</p>
      </div>` : `
      <div class="fgroup tint">
      <p class="fg-kicker">Who + when</p>
      <div class="form-2col">
        <div class="field"><label>Spots <span class="req-tag">Required</span> ${infoBtn("spots")}</label>${dragBarHtml("o2-spots", 1, 30, `placeholder="1" value="${dv(dft.spots)}" oninput="offerDraftSync()" onblur="offerValidateField('spots')"`)}<p class="field-err" id="err-o2-spots"></p></div>
      </div>
      ${windowModeFieldHtml("o2", dft.windowmode)}
      <div class="field"><label>Window note for the creator <span class="opt-tag">Optional</span> ${infoBtn("windownote")}</label><input id="o2-window" value="${dv(dft.window)}" placeholder="Evenings are best" oninput="offerDraftSync()"></div>
      </div>`}
      <div id="o2-dignity"></div>
      <div id="o2-strength" class="showcase-block"></div>
      <p class="small muted">Describe the experience, never the opinion.</p>
      <p class="small muted">${VISIT_GUARANTEE_LINE}</p>
      <div class="cta-row" style="justify-content:flex-start">
        <button class="btn" type="submit">Publish offer</button>
        <button class="btn ghost" type="button" onclick="return createOfferV2(event, true)">Save as draft</button>
      </div>
      ${marketLive ? "" : `<p class="small muted">Market not open yet — offers save as drafts until it does.</p>`}
    </form>
  </div>
  </div>
  <div id="offer-info-pop" class="sheet-overlay" style="display:none" onclick="if(event.target===this) closeOfferInfo()">
    <div class="sheet">
      <div class="flex-between"><strong id="offer-info-title"></strong><button type="button" class="linklike" onclick="closeOfferInfo()">Close</button></div>
      <p class="small" id="offer-info-body"></p>
    </div>
  </div>
  <div id="applicant-stack"></div>`;
  if (state.offersSeg === "past") { const lo = document.getElementById("offers-live-only"); if (lo) lo.remove(); }
  offerCoachUpdate();
  try {
    const data = await api("GET", "/offers");
    const list = document.getElementById("offer-list");
    if (!list) return;
    state.myOffers = data.offers || [];
    renderOffersSegTabs();
    renderOfferList();
  } catch (err) {
    const list = document.getElementById("offer-list");
    if (list) list.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// Offers list state (Overhaul V2): Current / Archived underline
// tabs over the fetched list. Current = draft, open or filled;
// Archived = closed, expired or declined.
let bizOfferTab = "current";
function offerSetTab(t) { bizOfferTab = t; renderOfferTabs(); renderOfferList(); return false; }
function offerIsArchived(o) { return ["closed", "expired", "declined"].includes(o.status); }
function renderOfferTabs() {
  const host = document.getElementById("offer-tabs");
  if (!host) return;
  const all = state.myOffers || [];
  host.innerHTML = wsTabs([
    { label: "Current", count: all.filter((o) => !offerIsArchived(o)).length, on: bizOfferTab === "current", onclick: "return offerSetTab('current')" },
    { label: "Archived", count: all.filter(offerIsArchived).length, on: bizOfferTab === "archived", onclick: "return offerSetTab('archived')" },
  ]);
}
function renderOfferList() {
  const list = document.getElementById("offer-list");
  if (!list) return;
  const all = state.myOffers || [];
  const rows = all.filter((o) => bizOfferTab === "archived" ? offerIsArchived(o) : !offerIsArchived(o));
  if (!rows.length) {
    list.innerHTML = `<div class="empty-card"><div class="ec-t">${bizOfferTab === "archived" ? "Nothing archived yet" : "No offers yet"}</div><div class="ec-s">${bizOfferTab === "archived" ? "Closed and expired offers collect here." : "Start from a template below, or build one in the composer."}</div></div>`;
    return;
  }
  list.innerHTML = `<div class="vx-stagger">${rows.map((o) => offerCardHtml(o)).join("")}</div>`;
}

function offerCardHtml(o) {
  const statusBadge = { draft: "warn", open: "ok", filled: "info", closed: "", expired: "bad", declined: "bad" }[o.status] || "";
  const terms = o.kind === "paid"
    ? `Cash $${fmtPrice(o.cashRate)} for the package (you pay $${fmtMoney(Number(o.cashRate) * 1.03)}, creator keeps $${fmtMoney(Number(o.cashRate) * 0.97)})`
    : `Cap $${fmtMoney(o.dollarCap)}`;
  const when = o.lane === "open" && o.windowStartAt
    ? `Redeem ${fmtDay(o.windowStartAt)} to ${fmtDay(o.windowEndAt)} &middot; Pick by ${fmtDay(o.selectionDeadline)}`
    : esc(o.visitWindow || "Flexible window");
  const firstMissing = o.strength && o.strength.checks ? (o.strength.checks.find((c) => !c.ok) || null) : null;
  const deliverable = o.kind === "paid" ? "Paid booking" : "1 post + 1 story";
  const pill = o.status === "open" ? livePill("Live") : o.status === "draft" ? `<span class="beta-pill">Draft</span>` : `<span class="beta-pill" style="background:var(--tint2);color:var(--ink2)">${esc(o.status)}</span>`;
  return `
  <div class="offer-card" id="offer-card-${o.id}">
    <div class="offer-top">
      <span class="offer-tile">${bnIcon("offers")}</span>
      <div style="flex:1;min-width:0">
        <div class="flex-between" style="gap:10px"><span class="offer-name">${esc(o.title)}</span>${pill}</div>
        <div class="offer-meta">${esc(o.whatComped)} · ${when}</div>
      </div>
    </div>
    <div class="set-chips">
      <span class="set-chip">${o.lane === "direct" ? (o.creatorHandle ? "Direct to @" + esc(o.creatorHandle) : "Direct") : "Open offer"}</span>
      <span class="set-chip">${o.kind === "paid" ? `Cash $${fmtPrice(o.cashRate)}` : `Comp up to $${fmtMoney(o.dollarCap)}`}</span>
      <span class="set-chip">${deliverable}</span>
      <span class="set-chip">${o.filledCount || 0}/${o.spots} spots filled</span>
      ${o.lane === "open" ? `<span class="set-chip more">${o.applicationCount || 0} applications</span>` : ""}
    </div>
    <div class="ws-offer-terms">
    <p class="small muted">${terms}${o.kind === "paid" ? "" : ` &middot; ${coversLine(o)}`}</p>
    ${o.kind === "paid" && o.paidBrief ? `<p class="small"><strong>Key points for the creator:</strong> ${esc(o.paidBrief)}</p>` : ""}
    ${o.businessReferralProgram ? `<p class="small"><strong>Referral program active:</strong> creators will see your ${o.businessReferralProgram.url ? "referral link" : "referral code"}${o.businessReferralProgram.note ? " and your note" : ""} on this offer.</p>` : ""}
    ${o.strength ? `<p class="small muted">Offer checklist ${o.strength.score} of ${o.strength.total}: ${firstMissing ? esc(firstMissing.label) : "complete"}</p>` : ""}
    </div>
    <div class="ws-offer-foot">
      <div><div class="ws-price">$${fmtPrice(o.kind === "paid" ? o.cashRate : o.dollarCap)}</div><div class="slot-note">${o.kind === "paid" ? "Rate" : "Comp cap"}</div></div>
      <div class="slot-actions">
        ${o.lane === "open" && (o.status === "open" || o.status === "filled") ? `<button class="btn small-btn ws-primary" onclick="return goApplicants('${o.id}')">Applicants (${o.applicationCount || 0})</button>` : ""}
        ${offerIsArchived(o) ? `<button class="btn small-btn ws-outline" onclick="return duplicateOffer('${o.id}')">Duplicate</button>` : ""}
        ${o.status === "draft" ? `<button class="btn small-btn ws-primary" onclick="publishOffer('${o.id}')">Publish</button>` : ""}
        ${o.nudgeSentAt && o.status === "open" && !(o.applicationCount > 0) ? `<button class="btn small-btn ws-outline" onclick="fixOffer('${o.id}','raise')">Raise comp +$25</button><button class="btn small-btn ws-outline" onclick="fixOffer('${o.id}','widen')">Widen window +3 days</button>` : ""}
        ${(o.status === "open" || o.status === "draft") ? `<button class="btn small-btn ws-outline" onclick="closeOffer('${o.id}')">Close offer</button>` : ""}
      </div>
    </div>
  </div>`;
}

async function publishOffer(offerId) {
  try {
    await api("POST", `/offers/${offerId}/publish`, {});
    loadMyOffers();
  } catch (err) { alert(err.message); }
}

async function closeOffer(offerId) {
  const ok = await showConfirmSheet("Close this offer?", "Anyone still waiting is released with a notification.", "Close offer");
  if (!ok) return;
  try {
    await api("POST", `/offers/${offerId}/close`, {});
    refreshBadges();
    loadMyOffers();
  } catch (err) { alert(err.message); }
}

async function createOfferV2(e, draft) {
  e.preventDefault();
  offerDraftSync();
  const d = state.offerDraft;
  const mode = composerMode();
  const kind = d.kind || "comp";
  const target = state.offerTarget;
  // Inline validation first: errors land under their fields, the
  // form is NOT re-rendered, and the draft keeps every keystroke.
  const requiredKeys = ["title", "comped", kind === "paid" ? "rate" : "cap", "spots"];
  let valid = true;
  for (const key of requiredKeys) { if (!offerValidateField(key)) valid = false; }
  if (!valid) return false;
  // Clean-start fields left empty take the defaults their
  // placeholders show (spots 1, apply days 3, window days 7).
  const payload = {
    title: d.title || "",
    whatComped: d.comped || "",
    includes: d.includes || "",
    experience: d.experience || "",
    kind,
    spots: parseInt(d.spots, 10) || 1,
    visitWindow: d.window || "",
    templateId: d.template || null,
    draft: draft === true,
    creatorId: mode === "direct" ? (target || null) : null,
  };
  if (kind === "paid") {
    payload.cashRate = parseFloat(d.rate);
    if (d.brief && d.brief.trim()) payload.paidBrief = d.brief.trim();
  } else {
    payload.dollarCap = parseInt(d.cap, 10);
    payload.covers = parseInt(d.covers, 10) || 1;
  }
  if (mode === "open") {
    payload.targetTiers = d.tiers || [];
    payload.applyWindowDays = parseInt(d.applydays, 10) || 3;
    payload.windowDays = parseInt(d.windowdays, 10) || 7;
  } else {
    payload.windowMode = d.windowmode || "7days";
  }
  try {
    await api("POST", "/offers", payload);
    state.offerDraft = {};
    state.offerTarget = null;
    refreshBadges();
    loadMyOffers();
  } catch (err) {
    // Server errors and the dedupe notice live in #form-error; the
    // form is never re-rendered on an error, so nothing typed is
    // lost, and the draft survives a 409 untouched.
    const fe = document.getElementById("form-error");
    if (fe) {
      fe.innerHTML = err.data && err.data.existingOfferId
        ? `<div class="error-box">This offer is already open. <button type="button" class="btn small-btn" onclick="jumpToOffer('${err.data.existingOfferId}')">Jump to that offer</button></div>`
        : `<div class="error-box">${esc(err.message)}</div>`;
    }
    window.scrollTo(0, 0);
  }
  return false;
}

// The applicant stack: ranked by local fit, Impact, Momentum,
// reliability (founding order breaks ties), each card showing the
// numbers the rank came from. Select creates the booking; release
// tells the creator, in plain words, never silence.
async function viewApplicants(offerId) {
  const el = document.getElementById("applicant-stack");
  if (!el) return;
  el.innerHTML = `<p class="muted">Loading the applicant stack...</p>`;
  try {
    const data = await api("GET", `/offers/${offerId}/applications`);
    const o = data.offer;
    const apps = data.applications || [];
    const waiting = apps.filter((a) => a.status === "applied" || a.status === "backfill_offered");
    el.innerHTML = `
    <div class="panel">
      <div class="flex-between"><h3 style="margin:0">Applicants: ${esc(o.title)}</h3><button class="btn small-btn ghost" onclick="document.getElementById('applicant-stack').innerHTML=''">Close</button></div>
      <p class="small muted">${o.filledCount || 0} of ${o.spots} spots filled &middot; selection deadline ${fmtDate(o.selectionDeadline)}. Ranked by local fit, Local Impact Score, Momentum, and reliability; founding order breaks ties. Anyone you do not pick is released with a notification when spots fill or the deadline passes.</p>
      ${apps.length ? apps.map((a) => applicantCardHtml(o, a)).join("") : `<p class="muted">No applications yet. Offers with a value in the typical range for their tier and a window of 3+ days fill first.</p>`}
      ${waiting.length ? "" : apps.length ? `<p class="small muted">Nobody is waiting on this offer right now.</p>` : ""}
    </div>`;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function applicantCardHtml(offer, a) {
  const c = a.creator || {};
  const tr = c.trackRecord || {};
  const ratingBit = c.ratingCount >= 1 && c.ratingAvg !== null && c.ratingAvg !== undefined
    ? ` &middot; ${starsHtml(c.ratingAvg)} <strong>${esc(String(c.ratingAvg))}</strong> (${c.ratingCount} rating${c.ratingCount === 1 ? "" : "s"})`
    : "";
  const stateLine = {
    applied: `<span class="badge info">Waiting</span>`,
    selected: `<span class="badge ok">Selected, visit booked</span>`,
    released: `<span class="badge">Released${a.releaseReason ? ": " + esc(a.releaseReason.replace(/_/g, " ")) : ""}</span>`,
    expired: `<span class="badge">Released: offer window passed</span>`,
    backfill_offered: `<span class="badge warn">Backfill spot offered, 24h window</span>`,
    backfill_accepted: `<span class="badge ok">Took the backfill spot</span>`,
  }[a.status] || esc(a.status);
  return `
  <div class="card mb">
    <div class="flex-between"><strong>${esc(c.name || a.snapshot.name)} <span class="muted">@${esc(c.handle || a.snapshot.handle)}</span></strong>${stateLine}</div>
    ${campusBadgeHtml(c) ? `<p class="small" style="margin-top:6px">${campusBadgeHtml(c)}</p>` : ""}
    <p class="small">${esc(c.tierBand || a.snapshot.tierBand || "")} &middot; ${c.localAudiencePct === null || c.localAudiencePct === undefined ? "local % not reported" : c.localAudiencePct + "% local audience"} &middot; Impact ${c.impact !== undefined && a.rankParts ? a.rankParts.impactScore : ""} &middot; Momentum ${a.rankParts ? a.rankParts.momentum : ""} pts${ratingBit}${badgesHtml(c.badges)} &middot; reliability ${a.rankParts ? a.rankParts.reliability : ""}</p>
    <p class="small muted">${tr.isNew || !tr.visitsCompleted ? "New to SIGNL: no visits yet." : `${tr.visitsCompleted} visits completed &middot; ${tr.postsDelivered} posts delivered &middot; ${tr.onTimePct === null || tr.onTimePct === undefined ? "on-time n/a" : tr.onTimePct + "% on time"}`} &middot; ${fmtNum(c.totalAudience || a.snapshot.totalAudience)} total audience${c.paidRate ? ` &middot; paid rate $${fmtPrice(c.paidRate)}` : ""}</p>
    ${(a.status === "applied" || a.status === "backfill_offered") ? `<div class="cta-row" style="justify-content:flex-start"><button class="btn small-btn" onclick="selectApplicant('${offer.id}','${a.id}')">Select this creator</button><button class="btn small-btn ghost" onclick="releaseApplicant('${offer.id}','${a.id}')">Release</button></div>` : ""}
  </div>`;
}

async function selectApplicant(offerId, applicationId) {
  try {
    await api("POST", `/offers/${offerId}/select`, { applicationId });
    state.applicantOffer = offerId;
    loadMyOffers();
  } catch (err) { alert(err.message); }
}

async function releaseApplicant(offerId, applicationId) {
  if (!confirm("Release this applicant? They are told right away, with the reason in plain words.")) return;
  try {
    await api("POST", `/offers/${offerId}/release`, { applicationId });
    viewApplicants(offerId);
  } catch (err) { alert(err.message); }
}

// ---------- counter ----------

function renderCounter(prefill) {
  const el = document.getElementById("tab-body");
  const code = prefill || state.counterCode || "";
  el.innerHTML = `
  ${wsHead("Counter", { sub: "Check a creator in at the register. One tap burns the code and starts the 48 hour post clock." })}
  <div class="panel" style="max-width:560px">
    <h3 style="margin-top:0">Counter check-in</h3>
    <p class="muted">The creator shows their code or QR at the visit. Scan the QR with any phone camera (it lands back here), or type the short code. One tap burns the code and starts the 48 hour post clock. Your register is never involved: ring the comp in your own system the way you normally do.</p>
    <p class="small">Handing this device to staff? <button class="linklike" onclick="return goStaff()">Redeem a creator visit</button> in staff mode: PIN in, code in, done. They never see anything but the visit in front of them.</p>
    <form onsubmit="return counterLookup(event)">
      <div class="field"><label>Booking code</label><input id="counter-code" value="${esc(code)}" placeholder="SGNL-XXXXXX" style="text-transform:uppercase;font-family:Manrope;font-weight:700;letter-spacing:0.06em" required></div>
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
        <p class="small muted">Comp cap $${fmtMoney(b.dollarCap)}${b.kind === "paid" || b.paidLane ? "" : ` &middot; ${coversLine(b)}`} &middot; Visit date: ${esc(b.visitDate || b.visitWindow || "Flexible")} &middot; Code ${esc(b.code)}</p>
        <p class="small">Check the person in front of you matches the creator, then redeem. The code burns and the 48 hour post clock starts now.</p>
        <button class="btn" style="width:100%" onclick="counterRedeem('${esc(code)}')">Redeem visit</button>
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
    el.innerHTML = `<div class="success-hero">${successCheckHtml()}<h3>Redeemed.</h3><p>${esc(b.creatorName)}'s post is due by <strong>${fmtDate(b.postDeadline)}</strong>. Ring the comp in your own system, up to the $${fmtMoney(b.dollarCap)} cap. Track the post under Visits &amp; Posts.</p></div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// ---------- staff mode ----------
// Staff redemption (Jeff, 2026-10-20 late): the register screen.
// Three taps and no menus: PIN in, creator code in (typed or
// scanned), one big REDEEM. The session is the server's scoped
// staff token (its own cookie), never a user account; this client
// only ever calls /staff/* while in this view. Entry points are
// the opening screen, the owner Business Home, the Counter tab,
// and the printed register card link (/redeem/<staff code>), all
// labeled the same: "Redeem a creator visit".

function goStaff() {
  // Admin presenters get the preview staff DEMO (refinement
  // bundle, 2026-10-20): when Jeff taps "Redeem a creator visit"
  // while presenting, the PIN flow he shows a business runs in
  // simulation against the example business, never against a real
  // business's staff mode.
  if (state.user && state.user.role === "admin") {
    if (state.preview && state.preview.dashboard) return pvStaffEnter();
    if (state.preview) { state.preview.wantStaffDemo = true; return previewToDashboard(); }
    enterPreview();
    if (state.preview) { state.preview.wantStaffDemo = true; previewToDashboard(); }
    return false;
  }
  if (state.preview) { stopPreviewCountdown(); state.preview = null; }
  stopHomeCountdown();
  state.view = "staff";
  render();
  return false;
}

async function renderStaff() {
  let sess = { active: false };
  try { sess = await api("GET", "/staff/session"); } catch (e) { /* treated as no session */ }
  state.staff = sess && sess.active ? sess : null;
  renderNav();
  if (state.staff) return staffCodeScreen();
  return staffPinScreen();
}

async function staffPinScreen() {
  // The preview demo's register link (refinement bundle,
  // 2026-10-20): /redeem/EMBER6 is the simulated business's sample
  // staff code. For an admin it opens the demo entry, never the
  // real staff flow (the real endpoints have never heard of it).
  // The code mirrors PREVIEW_STAFF_DEMO in the server router; the
  // authoritative demo values ride the preview dashboard payload.
  if (state.user && state.user.role === "admin" && state.staffCode === "EMBER6") {
    app.innerHTML = `
  <section class="panel" style="max-width:460px;margin:30px auto">
    <h2>Redeem a creator visit</h2>
    <div class="notice blue"><strong>Preview simulation.</strong> This register link belongs to the Preview example business (Salt & Ember Kitchen). Open the staff demo to run the PIN flow end to end in simulation. Nothing is saved and no real record changes.</div>
    <button class="btn" style="width:100%" onclick="return goStaff()">Open the staff demo</button>
    <p class="small muted mt">Real staff links open the real PIN screen. This one is the demo's, shown only to you as admin.</p>
  </section>`;
    return;
  }
  const ownerBiz = state.user && state.user.role === "business" ? state.user : null;
  let bizName = ownerBiz && ownerBiz.business ? ownerBiz.business.businessName : "";
  if (!bizName && state.staffCode && state.staffBizName) bizName = state.staffBizName;
  app.innerHTML = `
  <section class="panel" style="max-width:460px;margin:30px auto">
    <h2>Redeem a creator visit</h2>
    <p class="muted">Staff sign-in for the register. Enter the staff PIN your owner set. This device stays signed in for the shift (12 hours) and can only redeem creator visits${bizName ? ` at <strong>${esc(bizName)}</strong>` : ""}.</p>
    <div id="staff-error"></div>
    <form onsubmit="return staffEnter(event)">
      ${!ownerBiz && !state.staffCode ? `<div class="field"><label>Business code (on the register card)</label><input id="staff-bizcode" value="${esc(state.staffCode)}" style="text-transform:uppercase;font-family:Manrope;font-weight:700;letter-spacing:0.06em" autocomplete="off" required></div>` : ""}
      ${!ownerBiz && state.staffCode ? `<input type="hidden" id="staff-bizcode" value="${esc(state.staffCode)}">` : ""}
      <div class="field"><label>Staff PIN</label><input type="password" id="staff-pin" inputmode="numeric" autocomplete="off" maxlength="6" style="font-family:Manrope;font-weight:700;letter-spacing:0.3em" required></div>
      <button class="btn" type="submit" style="width:100%">Start staff mode</button>
    </form>
    <p class="small muted mt">No PIN yet? The owner sets it in the app under Plan, then Staff redemption.</p>
  </section>`;
  if (!bizName && state.staffCode) {
    try {
      const d = await api("GET", "/staff/business?code=" + encodeURIComponent(state.staffCode));
      state.staffBizName = d.businessName || "";
      const pinEl = document.getElementById("staff-pin");
      if (state.view === "staff" && !state.staff && !(pinEl && (pinEl.value || document.activeElement === pinEl))) staffPinScreen();
    } catch (e) { /* the enter call will surface a bad code plainly */ }
  }
}

async function staffEnter(e) {
  e.preventDefault();
  const form = e.target;
  if (!submitBusy(form, true)) return false;
  const errEl = document.getElementById("staff-error");
  try {
    const body = { pin: document.getElementById("staff-pin").value };
    const codeEl = document.getElementById("staff-bizcode");
    if (codeEl && codeEl.value.trim()) body.businessCode = codeEl.value.trim().toUpperCase();
    await api("POST", "/staff/enter", body);
    render();
  } catch (err) {
    submitBusy(form, false);
    if (errEl) errEl.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

function staffCodeScreen() {
  const s = state.staff;
  app.innerHTML = `
  <section class="panel" style="max-width:560px;margin:30px auto">
    <div class="flex-between"><h2 style="margin:0">Redeem a creator visit</h2><span class="badge tier">Staff mode</span></div>
    <p class="muted">${esc(s.businessName)} &middot; signed in for this shift. The creator shows their code or QR.</p>
    ${"BarcodeDetector" in window && navigator.mediaDevices ? `<button class="btn" style="width:100%;margin-bottom:12px" onclick="staffScan()">Scan the creator's QR</button>` : ""}
    <form onsubmit="return staffLookup(event)">
      <div class="field"><label>Creator's code</label><input id="staff-code" placeholder="SGNL-XXXXXX" style="text-transform:uppercase;font-family:Manrope;font-weight:700;letter-spacing:0.06em" autocomplete="off" required></div>
      <button class="btn" type="submit" style="width:100%">Look up visit</button>
    </form>
    <div id="staff-result" class="mt"></div>
    <div class="card mt">
      <strong>Log a code use</strong>
      <p class="small muted">A customer used a creator's audience code at the register (the code from their post, not the SGNL visit code)? Log it here: each use counts toward that visit's register tally estimate.</p>
      <form onsubmit="return staffLogCodeUse(event)">
        <div class="field"><label>Creator's audience code</label><input id="staff-audience-code" placeholder="From the creator's post" style="text-transform:uppercase" autocomplete="off" required></div>
        <button class="btn" type="submit" style="width:100%">Log a code use</button>
      </form>
      <div id="staff-code-use-result" class="mt"></div>
    </div>
    <p class="small mt"><button class="linklike" onclick="staffExit()">End staff session</button></p>
  </section>`;
}

async function staffLogCodeUse(e) {
  if (e) e.preventDefault();
  const input = document.getElementById("staff-audience-code");
  const el = document.getElementById("staff-code-use-result");
  try {
    const data = await api("POST", "/staff/code-use", { creatorCode: input.value.trim() });
    el.innerHTML = `<div class="notice blue"><strong>${esc(data.creatorName || "Creator")}:</strong> ${data.codeUseCount} code use${data.codeUseCount === 1 ? "" : "s"} logged.</div>`;
    input.value = "";
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

async function staffLookup(e, preset) {
  if (e) e.preventDefault();
  const code = (preset || document.getElementById("staff-code").value).trim().toUpperCase();
  const el = document.getElementById("staff-result");
  try {
    const data = await api("POST", "/staff/lookup", { code });
    const b = data.booking;
    if (b.redeemedAt) {
      el.innerHTML = `<div class="error-box">This code was already redeemed at ${fmtDate(b.redeemedAt)}. Codes work once.</div>`;
      return false;
    }
    if (b.windowStatus === "closed") {
      el.innerHTML = `<div class="error-box">This visit's redemption window has passed, so this code can no longer be redeemed.</div>`;
      return false;
    }
    el.innerHTML = `
      <div class="card">
        <div class="flex-between"><strong>${esc(b.creatorName)}</strong><span class="badge tier">@${esc(b.creatorHandle)}</span></div>
        <p>${esc(b.title)}: ${esc(b.whatComped)}</p>
        <p class="small muted">Comp cap $${fmtMoney(b.dollarCap)}${b.covers ? ` &middot; ${coversLine(b)}` : ""} &middot; Visit: ${esc(b.visitDate || b.visitWindow || "Flexible")}${b.redeemBy ? ` &middot; Redeem by ${fmtDate(b.redeemBy)}` : ""}</p>
        <p class="small">Check the person in front of you matches the creator, then redeem. The code burns and the 48 hour post clock starts now.</p>
        <button class="btn" style="width:100%" onclick="staffRedeem('${esc(code)}')">REDEEM</button>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
  return false;
}

async function staffRedeem(code) {
  const el = document.getElementById("staff-result");
  try {
    const data = await api("POST", "/staff/redeem", { code });
    const b = data.booking;
    el.innerHTML = `
      <div class="success-hero">
        ${successCheckHtml()}
        <h3>Redeemed.</h3>
        <p>${esc(b.creatorName)}'s visit is in, and their 48-hour post clock started. Their post is due by <strong>${fmtDate(b.postDeadline)}</strong>. Ring the comp in your own register, up to the $${fmtMoney(b.dollarCap)} cap.</p>
        <div class="mt"><button class="btn" style="width:100%" onclick="staffDone()">Done</button></div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function staffDone() {
  render();
  return false;
}

async function staffExit() {
  try { await api("POST", "/staff/exit", {}); } catch (e) { /* session is over either way */ }
  state.staff = null;
  state.staffBizName = "";
  if (state.user) { state.view = "dashboard"; }
  render();
  return false;
}

// Camera QR scan (where the platform supports it): the creator's
// QR encodes the counter URL carrying the code; staff mode pulls
// the code out and looks it up. Anything else falls back to typing.
let staffScanStream = null;
async function staffScan() {
  const overlay = document.createElement("div");
  overlay.id = "staff-scan-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(10,10,12,0.92);z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px";
  overlay.innerHTML = `
    <video id="staff-scan-video" autoplay playsinline style="width:100%;max-width:480px;border-radius:12px;background:#000"></video>
    <p class="small" style="color:#fff;margin:14px 0">Point the camera at the creator's QR code.</p>
    <button class="btn ghost" onclick="staffScanStop()">Cancel</button>`;
  document.body.appendChild(overlay);
  try {
    staffScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = document.getElementById("staff-scan-video");
    video.srcObject = staffScanStream;
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    const tick = async () => {
      if (!document.getElementById("staff-scan-overlay")) return;
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const raw = String(codes[0].rawValue || "");
          let code = "";
          const m = raw.match(/code=([A-Za-z0-9-]+)/);
          if (m) code = m[1].toUpperCase();
          else if (/SGNL-/i.test(raw)) code = raw.trim().toUpperCase();
          if (code) {
            staffScanStop();
            const input = document.getElementById("staff-code");
            if (input) { input.value = code; staffLookup(null, code); }
            return;
          }
        }
      } catch (e) { /* keep scanning */ }
      setTimeout(tick, 350);
    };
    tick();
  } catch (e) {
    staffScanStop();
    alert("The camera could not open here. Type the creator's code instead.");
  }
}

function staffScanStop() {
  if (staffScanStream) {
    for (const t of staffScanStream.getTracks()) t.stop();
    staffScanStream = null;
  }
  const overlay = document.getElementById("staff-scan-overlay");
  if (overlay) overlay.remove();
}


// ---------- plan tab ----------

function renderPlanTab() {
  const el = document.getElementById("tab-body");
  const u = state.user;
  const rl = u.business.reviewLinks || {};
  const plans = state.boot.plans.map((p) => `
    <div class="plan-card ${u.business.plan === p.id ? "selected" : ""}" id="plan-${esc(p.id)}" onclick="selectPlan('${esc(p.id)}')">
      <div class="price">$${fmtPrice(p.priceMonthly)}<span class="small muted">/mo</span></div>
      <div class="founding-badge-row">${foundingBadgeHtml(p)}</div>
      <strong>${esc(p.name)}</strong>
      <p class="small muted">${p.minMonths}-month minimum. Founding rate, locked while your plan stays active.</p>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      ${u.business.plan === p.id ? `<p class="saved mt">Your current plan</p>` : ""}
    </div>`).join("");
  el.innerHTML = `
  ${wsHead("Plan & billing", { sub: "Your founding plan, your visits, and your billing.", subKey: "biz-plan" })}
  <div class="panel mt tint">
    <h3>Your plan</h3>
    <p>Current plan: <strong>${esc(u.business.planName)}</strong>, selected ${fmtDate(u.business.planSelectedAt)}.</p>
    <p class="muted">${esc(u.business.billingStatus)}</p>
    <p class="small"><strong>${VISIT_GUARANTEE_LINE}</strong></p>
    ${paymentsLive()
      ? `<p class="small">The card below is for paid creator bookings: saved once, charged when you book, held until the post is live. Your plan itself still starts by hand at activation.</p>${cardOnFileSectionHtml()}`
      : `<p class="small">Payment stays concierge: when billing starts, Jeff sends the payment step by hand. Nothing is charged before then, and SIGNL never takes a card in the app.</p>`}
    <div class="plan-cards">${plans}</div>
    <input type="hidden" id="me-plan" value="${esc(u.business.plan)}">
    <button class="btn mt" onclick="savePlan()">Save plan selection</button>
    <p class="small muted mt">Until billing starts, your selection is recorded and your founding pricing stays locked while you stay subscribed.</p>
  </div>`
}

// Staff redemption settings (owner): the staff PIN, the business
// code and register card, and the sign-out-all-staff kill switch.
// The PIN itself is never shown (it lives server-side, hashed);
// this panel only ever learns whether one is set.
async function loadStaffSettings() {
  const el = document.getElementById("staff-settings");
  if (!el) return;
  try {
    const d = await api("GET", "/me/staff");
    el.innerHTML = `
    <h3>Staff redemption</h3>
    <p class="small muted">Your team at the register redeems creator visits without your login: they open the staff screen, enter this PIN, then the creator's code. A staff session lasts one shift (12 hours) and can only redeem visits. It never sees offers, money, messages, or ratings. Change the PIN any time; the old one stops working at once.</p>
    ${d.staffPinSet
      ? `<p><span class="badge ok">Staff PIN is set</span> <span class="small muted">since ${fmtDate(d.staffPinSetAt)}</span></p>`
      : `<p><span class="badge warn">No staff PIN yet</span> <span class="small muted">Staff cannot redeem visits until you set one.</span></p>`}
    <div class="form-2col">
      <div class="field"><label>${d.staffPinSet ? "New staff PIN (4 to 6 digits)" : "Staff PIN (4 to 6 digits)"}</label><input type="password" id="staff-pin-new" inputmode="numeric" autocomplete="off" maxlength="6"></div>
      <div class="field"><label>Confirm PIN</label><input type="password" id="staff-pin-confirm" inputmode="numeric" autocomplete="off" maxlength="6"></div>
    </div>
    <button class="btn" onclick="saveStaffPin()">${d.staffPinSet ? "Change staff PIN" : "Set staff PIN"}</button> <span id="staff-pin-ok" class="saved"></span>
    <h3 class="mt">Register card</h3>
    <p class="small muted">Print this card and keep it at the register. Staff scan it to open your staff screen (the PIN is still asked every shift), or they type your business code: <strong>${esc(d.staffCode || "")}</strong></p>
    <div class="form-2col" style="align-items:start">
      <div class="field"><label>Your staff link</label><input type="text" readonly value="${esc(d.staffLink || "")}" onclick="this.select()"></div>
      <div><img src="/api/me/staff/register-card-qr" alt="QR code for your staff redemption link" style="width:150px;height:150px;background:#fff;border:1px solid var(--line,#ddd);border-radius:8px"></div>
    </div>
    <button class="btn ghost" onclick="printStaffCard()">Print register card</button>
    <h3 class="mt">Staff devices</h3>
    <p class="small muted">${d.activeStaffSessions} staff session${d.activeStaffSessions === 1 ? "" : "s"} active right now. If a team member leaves, sign out every staff device and change the PIN: every phone at the register will ask for the PIN again.</p>
    <button class="btn danger" onclick="staffSignOutAll()">Sign out devices</button> <span id="staff-out-ok" class="saved"></span>`;
  } catch (err) {
    el.innerHTML = `<h3>Staff redemption</h3><div class="error-box">${esc(err.message)}</div>`;
  }
}

async function saveStaffPin() {
  const pin = document.getElementById("staff-pin-new").value;
  const confirmPin = document.getElementById("staff-pin-confirm").value;
  if (pin !== confirmPin) { alert("The two PINs do not match. Type the same PIN twice."); return; }
  try {
    await api("POST", "/me/staff/pin", { pin });
    document.getElementById("staff-pin-ok").textContent = "Saved. The new PIN works now; the old one is done.";
    loadStaffSettings();
  } catch (err) { alert(err.message); }
}

async function staffSignOutAll() {
  if (!confirm("Sign out every staff device? Each one will need the staff PIN to redeem again.")) return;
  try {
    const d = await api("POST", "/me/staff/signout-all", {});
    document.getElementById("staff-out-ok").textContent = `Done. ${d.killed} staff session${d.killed === 1 ? "" : "s"} signed out.`;
    loadStaffSettings();
  } catch (err) { alert(err.message); }
}

// The printable register card: a clean standalone page with the
// real logo, the business's own QR, and the one line staff need.
async function printStaffCard() {
  try {
    const d = await api("GET", "/me/staff");
    const w = window.open("", "_blank", "width=640,height=760");
    if (!w) { alert("Allow pop-ups to print the register card, or screenshot the QR and link above."); return; }
    const origin = location.origin;
    w.document.write(`<!DOCTYPE html><html><head><title>SIGNL register card</title>
    <style>body{font-family:Arial,sans-serif;text-align:center;padding:36px;color:#0B0D0C}img.logo{height:54px}img.qr{width:260px;height:260px}.biz{font-size:22px;font-weight:700;margin:10px 0 2px}.big{font-size:30px;font-weight:800;letter-spacing:0.02em;margin:18px 0 6px}.line{font-size:17px}.code{font-family:monospace;font-size:19px;font-weight:700;letter-spacing:0.12em}.muted{color:#666;font-size:13px}</style></head>
    <body>
      <img class="logo" src="${origin}/assets/logo.png" alt="SIGNL">
      <div class="biz">${esc(d.businessName)}</div>
      <div class="big">Redeem a creator visit</div>
      <img class="qr" src="${origin}/api/me/staff/register-card-qr" alt="QR code for the staff redemption link">
      <p class="line">Staff: scan, enter the PIN, scan the creator's code.</p>
      <p class="muted">Or open <strong>${esc(d.staffLink || "")}</strong><br>Business code: <span class="code">${esc(d.staffCode || "")}</span></p>
    </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) { /* the card is on screen either way */ } }, 450);
  } catch (err) { alert(err.message); }
}

async function saveBusinessProfile() {
  try {
    const data = await api("PATCH", "/me/profile", {
      businessName: document.getElementById("bp-name").value,
      category: document.getElementById("bp-category").value,
      city: document.getElementById("bp-city").value,
      neighborhood: document.getElementById("bp-neighborhood").value,
      about: document.getElementById("bp-about").value,
    });
    state.user = data.user;
    render();
    setTimeout(() => { const ok = document.getElementById("bp-ok"); if (ok) ok.textContent = "Saved."; }, 30);
  } catch (err) { alert(err.message); }
}

async function saveMyAverageTicket() {
  try {
    const raw = document.getElementById("me-avg-ticket").value;
    const data = await api("PATCH", "/me/profile", { averageTicket: raw === "" ? null : Number(raw) });
    state.user = data.user;
    document.getElementById("ticket-ok").textContent = "Saved.";
    renderPlanTab();
  } catch (err) { alert(err.message); }
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

async function saveMyReferralProgram() {
  try {
    const data = await api("PATCH", "/me/profile", {
      referralUrl: document.getElementById("rp-url").value,
      referralCode: document.getElementById("rp-code").value,
      referralNote: document.getElementById("rp-note").value,
    });
    state.user = data.user;
    document.getElementById("rp-ok").textContent = "Saved.";
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
// Threads carry no context object in their payload, so the
// offer/visit a thread is about is derived on the client
// (Amendment B): stashed when the thread is opened from a
// known context, otherwise matched against the user's own
// bookings and offers. It reads "Re: <offer or visit title>".
function openThreadCtx(otherId, title) {
  state.threadContext = state.threadContext || {};
  if (title) state.threadContext[otherId] = `Re: ${title}`;
  openThread(otherId);
  return false;
}
function threadContextFor(otherId) {
  const stash = (state.threadContext || {})[otherId];
  if (stash) return stash;
  const mine = Object.values(state.nudgeBookings || {});
  const b = mine.find((x) => (state.user.role === "business" ? x.creatorId : x.businessId) === otherId);
  if (b) return `Re: ${b.title}`;
  const o = (state.myOffers || []).find((x) => x.creatorId === otherId);
  if (o) return `Re: ${o.title}`;
  return "";
}

// Conversations (Grin pattern): search, a segmented switch, one
// "New message" primary. SIGNL keeps no per-thread read state, so
// the switch is honest about what it filters: "Waiting on you" =
// threads where the last message came from the other side.
let msgMode = "all";
let msgQ = "";
function msgSetMode(v) { msgMode = v; renderThreadList(); return false; }
function msgSetQ(v) { msgQ = v; renderThreadList(true); return false; }
function threadItemsHtml() {
  const me = state.user.id;
  let threads = state.threads || [];
  if (msgMode === "waiting") threads = threads.filter((t) => t.lastMessage && t.lastMessage.fromId !== me);
  const q = msgQ.trim().toLowerCase();
  if (q) threads = threads.filter((t) => ((t.otherBusinessName || t.otherName || "") + " " + (t.otherHandle || "")).toLowerCase().includes(q));
  if (!threads.length) return `<div class="empty-card"><div class="ec-t">No conversations here</div><div class="ec-s">${msgMode === "waiting" ? "Nothing is waiting on you. When someone writes and you have not answered yet, it lands here." : "No conversations match that search."}</div></div>`;
  return `<div class="thread-list">${threads.map((t) => `
        <div class="thread-item" onclick="openThread('${t.otherId}')">
          <strong>${esc(t.otherBusinessName || t.otherName)}</strong> ${t.otherHandle ? `<span class="muted">@${esc(t.otherHandle)}</span>` : ""}${t.lastMessage && t.lastMessage.fromId !== me ? ` <span class="badge info">Waiting on you</span>` : ""}
          ${threadContextFor(t.otherId) ? `<div class="small thread-ctx">${esc(threadContextFor(t.otherId))}</div>` : ""}
          <div class="small muted">${esc((t.lastMessage.body || "").slice(0, 90))}</div>
        </div>`).join("")}</div>`;
}
function renderThreadList(keepFocus) {
  const host = document.getElementById("thread-list-wrap");
  if (!host) return;
  host.innerHTML = threadItemsHtml();
  const seg = document.getElementById("msg-seg");
  if (seg) seg.innerHTML = segSw([{ v: "waiting", label: "Waiting on you" }, { v: "all", label: "All" }], msgMode, "msgSetMode");
  if (keepFocus) { const inp = document.getElementById("msg-q"); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
}
async function loadThreads() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/messages");
    state.threads = data.threads;
    const newGo = state.user.role === "business" ? "return go('dashboard','Discover')" : "return go('dashboard','Offers')";
    el.innerHTML = `
    ${wsHead("Messages", { sub: state.user.role === "business" ? "Talk to a creator about a visit or an offer." : "Talk to a business about a visit or an offer.", subKey: "messages" })}
    <div class="ws-tools">
      <span class="ws-search">${bnIcon("search")}<input id="msg-q" type="search" placeholder="Search conversations" value="${esc(msgQ)}" oninput="msgSetQ(this.value)"></span>
      <span id="msg-seg">${segSw([{ v: "waiting", label: "Waiting on you" }, { v: "all", label: "All" }], msgMode, "msgSetMode")}</span>
      <span class="sp"></span>
      <button type="button" class="btn ws-primary" onclick="${newGo}">${state.user.role === "business" ? "Find creators" : "See offers"}</button>
    </div>
    <div class="grid cols-2"><div id="thread-list-wrap">${data.threads.length || state.activeThread ? threadItemsHtml() : `<div class="empty-card"><div class="ec-t">No messages yet</div><div class="ec-s">When you invite a creator, apply to an offer, or answer an applicant, your conversation lives here.</div></div>`}</div>
    <div id="thread-view">${state.activeThread ? `<p class="muted">Loading conversation...</p>` : `<p class="muted">Pick a conversation.</p>`}</div></div>`;
    if (state.activeThread) loadConversation(state.activeThread);
  } catch (err) {
    el.innerHTML = `${wsHead("Conversations")}<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function loadConversation(otherId) {
  const el = document.getElementById("thread-view");
  if (!el) return;
  try {
    const data = await api("GET", "/messages?with=" + encodeURIComponent(otherId));
    const t0 = (state.threads || []).find((t) => t.otherId === otherId) || {};
    const ctxLine = threadContextFor(otherId);
    el.innerHTML = `
      <div class="thread-head"><strong>${esc(t0.otherBusinessName || t0.otherName || "Conversation")}</strong>${ctxLine ? `<div class="small thread-ctx">${esc(ctxLine)}</div>` : ""}<div class="small muted">Contact about this visit or offer. Messages stay in SIGNL.</div></div>
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
    refreshBadges();
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

// Outreach campaigns (Jeff, 2026-10-19; business wave added
// 2026-10-23; hello@ founding lane added 2026-10-25): the
// outreach email sends from inside the app
// (its own SMTP transport), so there is no per-send approval
// card. This tab is the control surface for every campaign in
// the CAMPAIGN_SECTIONS registry: queue counts, the last error
// if a run stopped, recent sends, and the Arm / Pause switch
// per campaign. The founding campaign pitches a founding
// creator spot; the hello@ lane (2026-10-25) is a second
// founding-creators campaign sending the identical email from
// the default hello@joinsignl.com mailbox, so volume is not
// capped by the creators@ signlteam warm-up; the crossover
// campaign (added later the same day) pitches creators
// already on national platforms the
// additive local layer, and its imports skip any address the
// founding campaign already holds; the founding businesses
// campaign (kind "business") emails local businesses a
// prebuilt founding signup link, and its recipients carry
// business fields instead of a handle. Recipients are imported
// by pasting a JSON array into the box on the campaign's
// section, which posts to the admin import endpoint; sending
// runs on the 30-minute scheduled sweep, inside the
// 08:00-21:00 ET window, in batches of 8, under a global daily
// ceiling of 40 sends per ET day across all campaigns (it
// protects the sending domain).
const CAMPAIGN_SECTIONS = [
  { key: "founding", suffix: "", kind: "creator", campaignId: "founding-creators-2026-10", title: "Founding creators", blurb: "The founding creator email: a founding spot in their market, comped local experiences for honest posts within 48 hours, and a live founding profile from day one." },
  { key: "founding-hello", suffix: "-hello", kind: "creator", campaignId: "founding-creators-hello-2026-10", title: "Founding creators (hello@ lane)", blurb: "The same founding creator email as the Founding creators campaign, sent from the default hello@joinsignl.com mailbox instead of creators@signlteam.com: a second lane, so founding outreach volume is not capped by the creators@ warm-up." },
  { key: "crossover", suffix: "-crossover", kind: "creator", campaignId: "founding-crossover-2026-10", title: "Platform crossover creators", blurb: "For creators already working national platforms like Grin, Cohley, or Momfluence. The pitch is additive and non-exclusive: keep those deals, SIGNL is the local layer on top. Imports skip any address the founding campaign already holds, so nobody receives both emails." },
  { key: "business", suffix: "-business", kind: "business", campaignId: "founding-businesses-2026-10", title: "Founding businesses", blurb: "The founding business wave: local businesses get a founding spot with their registration prebuilt, claimed through their own signup link. It asks nothing today and commits them to nothing; claiming just puts them in early for launch updates." },
];

// Sender profiles for the campaign card's "Sends from" select
// (Jeff, 2026-10-24). The select posts its value as the campaign's
// fromMailbox. "default" is the shipped behavior; the
// signlteam.com profiles send only once their SMTP credentials
// exist in the server environment, and until then the sweep skips
// the campaign instead of sending from the wrong address.
const CAMPAIGN_SENDER_OPTIONS = [
  { value: "default", label: "Default: SIGNL <hello@joinsignl.com>" },
  { value: "creators", label: "creators@signlteam.com" },
  { value: "team", label: "team@signlteam.com" },
  { value: "hello_team", label: "hello@signlteam.com" },
];
const CAMPAIGN_SENDER_ADDR = { default: "hello@joinsignl.com", creators: "creators@signlteam.com", team: "team@signlteam.com", hello_team: "hello@signlteam.com" };

async function loadCampaign() {
  const el = document.getElementById("tab-body");
  try {
    const creatorSections = [];
    const businessSections = [];
    let ceilingCfg = null;
    for (const meta of CAMPAIGN_SECTIONS) {
      const data = await api("GET", "/admin/campaign?campaignId=" + encodeURIComponent(meta.campaignId));
      if (meta.kind === "creator" && !ceilingCfg && data && data.campaign) ceilingCfg = data.campaign;
      (meta.kind === "business" ? businessSections : creatorSections).push(campaignSectionHtml(meta, data));
    }
    // Send figures read off the live campaign config (2026-10-26
    // cleanup): the old hardcoded daily figure was stale.
    // The shared ceiling and the creators@ warm-up cap come from
    // the server; the literals are only fallback display values.
    const ceiling = (ceilingCfg && ceilingCfg.dailyCeiling) || 150;
    const teamCap = (ceilingCfg && ceilingCfg.teamMailDailyCap) || 50;
    el.innerHTML = `
      <h3 style="margin:0 0 8px">Creator outreach campaigns</h3>
      <p class="small muted">Both campaigns send through the same sweep: up to 8 emails per campaign every 30 minutes while armed, only between 8:00 and 21:00 ET. One daily ceiling covers everything: ${ceiling} sends per day (ET) across all campaigns, to protect the sending domain. The creators@signlteam.com mailbox also has its own warm-up cap of ${teamCap} sends per day. Hitting a cap is normal; the queues wait for the next day. A queue auto-pauses when it empties.</p>
      ${creatorSections.join("")}
      <h3 style="margin:24px 0 8px">Business outreach campaigns</h3>
      <p class="small muted">The founding business wave sends through the same sweep, under the same shared daily ceiling: ${ceiling} sends per day (ET) across all campaigns. Nothing sends until the campaign is armed.</p>
      ${businessSections.join("")}`;
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
      <p class="small muted">${meta.kind === "business" ? `${esc(s.market || "")} &middot; ${esc(s.email)}` : `@${esc(s.handle || "")} &middot; ${esc(s.market || "")} &middot; ${esc(s.email)}`}${s.sentAt ? ` &middot; ${esc(fmtDate(s.sentAt))}` : ""}</p>
    </div>`).join("");
  const importHelp = meta.kind === "business"
    ? "Paste a JSON array of recipient objects: email, businessName, greeting, category, appCategory, neighborhood and market are required. Imported businesses join this campaign's queue; nothing sends until the campaign is armed."
    : "Paste a JSON array of recipient objects: email, handle, market and opener are required; name is optional. Imported addresses join this campaign's queue; nothing sends until the campaign is armed.";
  const importPlaceholder = meta.kind === "business"
    ? `[{"email":"owner@example.com","businessName":"Example Cafe","greeting":"Example team","category":"cafe","appCategory":"Coffee & Bakery","neighborhood":"Downtown","market":"Virginia Beach"}]`
    : `[{"email":"creator@example.com","name":"Casey","handle":"casey","market":"Richmond","opener":"your Carytown posts"}]`;
  return `
  <div class="panel camp-panel">
    <div class="flex-between"><h3 style="margin:0">${esc(meta.title)}</h3><span class="badge ${c.armed ? "ok" : "info"}">${c.armed ? "Armed" : "Paused"}</span></div>
    <p class="small muted" style="margin-top:8px">Campaign <strong>${esc(c.id || meta.campaignId)}</strong>. ${esc(meta.blurb)}${c.lastRunAt ? ` Last sweep: ${esc(fmtDate(c.lastRunAt))}.` : ""} Send window is ${c.windowOpenNow ? "open now" : "closed right now"}.</p>
    ${c.lastError ? `<div class="error-box">${esc(c.lastError)}</div>` : ""}
    ${data.degraded ? `<div class="error-box">Campaign data could not be loaded just now, so this card is showing zeros. Refresh in a moment; nothing here was changed.</div>` : ""}
    <p class="small camp-counts">Queued: <strong>${counts.queued || 0}</strong> &middot; Sent: <strong>${counts.sent || 0}</strong> &middot; Bounced: <strong>${counts.bounced || 0}</strong> &middot; Skipped: <strong>${counts.skipped || 0}</strong> &middot; Total: <strong>${counts.total || 0}</strong> &middot; Sent today: <strong>${c.sentToday != null ? c.sentToday : 0} of ${c.dailyCeiling || 150} (daily ceiling)</strong></p>
    ${c.sentTodayByLane ? `<p class="small muted">Sent today by lane: ${Object.entries(c.sentTodayByLane).map(([k, n]) => `${esc(CAMPAIGN_SENDER_ADDR[k] || k)}: <strong>${n}</strong>`).join(" &middot; ") || "none yet"}</p>` : ""}
    <div class="field" style="max-width:440px"><label>Sends from</label><select id="campaign-sender${meta.suffix}" onchange="setCampaignSender('${meta.key}')">${CAMPAIGN_SENDER_OPTIONS.map((o) => `<option value="${o.value}" ${(c.fromMailbox || "default") === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select></div>
    <p class="small muted">${campaignSenderNote(c, data.senderProfiles || {})}</p>
    <button class="btn ${c.armed ? "danger" : ""}" onclick="toggleCampaignArm(${c.armed ? "false" : "true"}, '${meta.campaignId}')">${c.armed ? "Pause campaign" : "Arm campaign"}</button>
    <div id="campaign-note${meta.suffix}" class="small saved"></div>
    <h3 class="mt">Import recipients</h3>
    <p class="small muted">${importHelp}</p>
    <div class="field"><label>Paste recipients (JSON array)</label><textarea id="campaign-import-text${meta.suffix}" rows="8" placeholder='${importPlaceholder}'></textarea></div>
    <button class="btn" onclick="importCampaignRecipients('${meta.key}')">Import recipients</button>
    <div id="campaign-import-note${meta.suffix}" class="small saved"></div>
    ${sends ? `<h3 class="mt">Recent sends</h3>${sends}` : `<p class="muted mt">No sends yet.</p>`}
  </div>`;
}

// The line under the "Sends from" select: what the campaign will
// actually send as, and, for a signlteam profile that is not live
// yet, the plain warning that the sweep skips this campaign
// rather than send from the wrong address.
function campaignSenderNote(c, profiles) {
  const key = c.fromMailbox || "default";
  const addr = CAMPAIGN_SENDER_ADDR[key] || CAMPAIGN_SENDER_ADDR.default;
  if (key === "default") return "Sending as SIGNL &lt;hello@joinsignl.com&gt; (the default mailbox).";
  if (profiles[key]) return `Sending as SIGNL &lt;${addr}&gt;. Replies go to hello@joinsignl.com. Warm-up cap: ${c.teamMailDailyCap || 25} sends per day for this mailbox, on top of the shared daily ceiling.`;
  return `Mailbox ${addr} is selected but NOT active: its SMTP credentials are not in the server environment yet, so the sweep will skip this campaign rather than send from the wrong address.`;
}

async function setCampaignSender(sectionKey) {
  const meta = CAMPAIGN_SECTIONS.find((s) => s.key === sectionKey) || CAMPAIGN_SECTIONS[0];
  const sel = document.getElementById("campaign-sender" + meta.suffix);
  if (!sel) return;
  try {
    await api("POST", "/admin/campaign/sender", { campaignId: meta.campaignId, fromMailbox: sel.value });
    await loadCampaign();
    const fresh = document.getElementById("campaign-note" + meta.suffix);
    if (fresh) fresh.textContent = "Sender mailbox updated.";
  } catch (err) {
    const note = document.getElementById("campaign-note" + meta.suffix);
    if (note) note.textContent = err.message;
  }
}

async function toggleCampaignArm(arm, campaignId) {
  try {
    await api("POST", arm ? "/admin/campaign/arm" : "/admin/campaign/disarm", { campaignId: campaignId || "founding-creators-2026-10" });
    loadCampaign();
  } catch (err) {
    for (const meta of CAMPAIGN_SECTIONS) {
      const note = document.getElementById("campaign-note" + meta.suffix);
      if (note && (!campaignId || meta.campaignId === campaignId)) note.textContent = err.message;
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
    const payload = { campaignId: meta.campaignId, recipients };
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
    if (note) note.textContent = `Sweep ran: ${(s.reminder1 || 0) + (s.reminder2 || 0) + (s.reminder3 || 0)} reminder(s), ${s.paused || 0} pause(s), ${s.banned || 0} ban(s), ${s.expired || 0} window expiration(s), ${s.performance || 0} performance request(s)${s.strikes ? `, ${s.strikes} no-show strike(s)` : ""}${s.strikePaused ? `, ${s.strikePaused} strike pause(s)` : ""}.`;
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
      <p class="muted small">A market that is not live shows creators their founding status page only: no offers, no discovery. Activating a market opens publishing and bookings there, but it does NOT activate founding businesses: business activation is a separate admin action, per business or for every founding business in a market. Founding creators keep sign-up-order priority in discovery.</p>
      ${data.testMode ? `<div class="error-box">TEST MODE is on (SIGNL_TEST_ALLOW_BUSINESS): every market reads live. Never run production this way.</div>` : ""}
      <div class="table-wrap panel"><table>
        <tr><th>Market</th><th>Status</th><th>Roster</th><th>Action</th></tr>
        ${data.markets.map((m) => `<tr>
          <td><strong>${esc(m.label)}</strong><br><span class="muted small">${esc(m.country || "United States")}</span></td>
          <td>${m.live ? `<span class="badge ok">Live</span>` : `<span class="badge info">Founding only</span>`}</td>
          <td><strong>${m.creatorsApproved}</strong> approved creators &middot; <strong>${m.creatorsApprovedComplete || 0}</strong> complete &middot; <strong>${m.creatorsPending}</strong> pending<br><span class="muted small"><strong>${m.businessesApproved}</strong> approved businesses &middot; ${m.businessesFounding || 0} on the founding list &middot; ${m.businessesActive || 0} active</span></td>
          <td><button class="btn small-btn ${m.live ? "danger" : ""}" onclick="toggleMarket('${esc(m.name)}', ${m.live ? "false" : "true"})">${m.live ? "Deactivate" : "Activate market"}</button><div class="muted small" style="margin-top:4px">${m.live ? "Back to founding only: no new offers or bookings there." : "Opens publishing and bookings here. Founding businesses still activate separately."}</div>${m.businessesFounding ? `<button class="btn small-btn ghost" style="margin-top:6px" onclick="activateMarketBusinesses('${esc(m.name)}')">Activate founding businesses (${m.businessesFounding})</button>` : ""}</td>
        </tr>`).join("")}
      </table></div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function toggleMarket(market, live) {
  if (!confirm(`${live ? "Activate" : "Deactivate"} the ${market} market?${live ? " This opens publishing and bookings there. It does not activate founding businesses; that stays a separate action." : ""}`)) return;
  try {
    await api("POST", "/admin/markets/toggle", { market, live });
    loadMarkets();
  } catch (err) { alert(err.message); }
}

async function activateMarketBusinesses(market) {
  if (!confirm(`Activate every approved founding business in ${market}? Each one gets full product access (browse, favorites, drafts). Publishing still follows the market live flag.`)) return;
  try {
    const data = await api("POST", "/admin/businesses/activate-market", { market });
    alert(`Activated ${data.activatedCount} founding business${data.activatedCount === 1 ? "" : "es"} in ${market}.`);
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
      const businessState = u.role === "business"
        ? `<br><span class="badge ${businessAccessState(u) === "active" ? "ok" : "info"}">${businessAccessState(u) === "active" ? "Active" : "Founding list"}</span>`
        : "";
      // The applicant's handle is a live link to their real page
      // (Jeff, 2026-10-26: "they should have to link instagram so
      // I can verify their page"). The server payload carries the
      // computed primary profile URL; a record with no URL left
      // renders the plain handle, never a fabricated link.
      const handleHtml = u.role === "creator" && u.creator
        ? (u.creator.primaryProfileUrl
          ? `<a href="${esc(u.creator.primaryProfileUrl)}" target="_blank" rel="noopener">@${esc(u.creator.handle)}</a>`
          : `@${esc(u.creator.handle)}`)
        : "";
      const detail = u.role === "creator" && u.creator
        ? `${handleHtml} (${esc(primaryLabelClient(u.creator.primaryPlatform || "instagram"))}) &middot; ${fmtNum(u.creator.followerCount)} followers &middot; ${esc(u.creator.tierBand)} &middot; Local: ${u.creator.localAudiencePct === null ? "not reported" : u.creator.localAudiencePct + "% (Self-reported)"} &middot; ${(u.creator.categories || []).map(esc).join(", ")} &middot; Photo: ${u.creator.hasPhoto ? "yes" : "no"} &middot; Socials: IG${u.creator.tiktokHandle ? ", TikTok" : ""}${u.creator.youtubeChannel ? ", YouTube" : ""}${u.creator.facebookUrl ? ", Facebook" : ""}${u.creator.xUrl ? ", X" : ""}${u.creator.linkedinUrl ? ", LinkedIn" : ""}${u.creator.neighborhood ? ` &middot; Area: ${esc(u.creator.neighborhood)}` : ""}${u.creator.profession ? ` &middot; Profession: ${esc(u.creator.profession)}` : ""}${u.creator.profession === "Real estate agent" && u.creator.farmAreas && u.creator.farmAreas.length ? ` &middot; Neighborhoods: ${u.creator.farmAreas.map(esc).join(", ")}` : ""}${u.creator.profession === "Real estate agent" && u.creator.brokerage ? ` &middot; Brokered by: ${esc(u.creator.brokerage)}` : ""}${u.creator.university || u.university ? ` &middot; University: ${esc(u.creator.university || u.university)}${universityStatusSuffix(u)}${u.universityUnverified || (u.creator && u.creator.universityUnverified) ? " (unverified)" : ""}` : ""}${u.referredBy ? ` &middot; Via referral: @${esc(u.referredBy)}` : ""}${u.signupSource ? ` &middot; Source: ${esc(u.signupSource)}` : ""}${u.momentum && u.momentum.signups ? ` &middot; Momentum: ${u.momentum.points} pts (${u.momentum.signups} joined, ${u.momentum.approved} approved)` : ""}${u.rejectionReason ? ` &middot; Rejection reason: ${esc(u.rejectionReason)}` : ""}`
        : u.role === "business" && u.business
          ? `${esc(u.business.businessName)} &middot; ${esc(u.business.category)} &middot; ${esc(u.business.planName)} &middot; Access: ${businessAccessState(u) === "active" ? "Active" : "Founding list"}${u.business.subscription ? ` &middot; Subscription: ${esc(u.business.subscription.status || "unknown")}${u.business.subscription.planName ? ` (${esc(u.business.subscription.planName)})` : ""}` : ""}${u.referredBy ? ` &middot; Via referral: @${esc(u.referredBy)}` : ""}${u.signupSource ? ` &middot; Source: ${esc(u.signupSource)}` : ""}`
          : "";
      // Typed-city suggestion (Jeff, 2026-10-23): an unlisted
      // record whose typed city already belongs to a market shows
      // the resolver's suggestion with a one-tap filing action.
      // An ambiguous city names its candidates, one button each.
      const suggestion = u.marketSuggestion && u.marketSuggestion.status === "unique"
        ? `<br><span class="small">Suggested: ${esc(u.marketSuggestion.market)} (from ${esc(u.marketSuggestion.city)})</span><br><button class="btn small-btn" style="margin-top:4px" onclick="fileUnderMarket('${u.id}', '${esc(u.marketSuggestion.market)}')">File under ${esc(u.marketSuggestion.market)}</button>`
        : u.marketSuggestion && u.marketSuggestion.status === "ambiguous"
          ? `<br><span class="small">Could be: ${u.marketSuggestion.markets.map(esc).join(" or ")} (from ${esc(u.marketSuggestion.city)})</span>${u.marketSuggestion.markets.map((m) => `<br><button class="btn small-btn" style="margin-top:4px" onclick="fileUnderMarket('${u.id}', '${esc(m)}')">File under ${esc(m)}</button>`).join("")}`
          : "";
      return `<tr>
        <td><strong>${esc(u.name)}</strong><br><span class="muted small">${esc(u.email)}</span></td>
        <td>${esc(u.role)}${standing}${businessState}</td><td>${esc(marketDisplayName(u.market))}<br><span class="muted small">${esc(u.city || "")}${u.market === unlistedLabel() ? (u.country ? ", " + esc(u.country) : u.state ? ", " + esc(u.state) : "") : (u.state ? ", " + esc(u.state) : "")}</span>${suggestion}</td>
        <td class="small">${detail}</td>
        <td data-label="Applied">${fmtDate(u.createdAt)}</td>
        <td>${u.status === "pending"
          ? `<button class="btn small-btn" onclick="reviewApp('${u.id}','approve')">Approve</button> <button class="btn small-btn danger" onclick="toggleRejectEditor('${u.id}')">Reject</button><div id="rej-edit-${u.id}" style="display:none;margin-top:8px;min-width:260px"><div class="field"><label>Reason (optional, named in their rejection email)</label><select id="rej-reason-${u.id}"><option value="">No reason given</option><option>Not local enough</option><option>Audience too small for this wave</option><option>Content not a fit</option><option>Market not open yet</option><option>Other</option></select></div><button class="btn small-btn danger" onclick="confirmRejectApp('${u.id}')">Send rejection</button></div>`
          : `<span class="badge ${u.status === "approved" ? "ok" : "bad"}">${esc(u.status)}</span>${u.tester ? ` <span class="badge warn">Tester</span>` : ""}${u.role === "creator" && u.status === "approved" ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="setTester('${u.id}', ${u.tester ? "false" : "true"}, 'creator')">${u.tester ? "Move to roster" : "Move to Tester"}</button>` : ""}`}${u.role === "business" && u.status === "approved" && businessAccessState(u) !== "active" ? `<br><button class="btn small-btn" style="margin-top:6px" onclick="activateBusiness('${u.id}')">Activate business</button>` : ""}${u.role === "business" && u.status === "approved" ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="setTester('${u.id}', ${u.tester ? "false" : "true"}, 'business')">${u.tester ? "Move to roster" : "Move to Tester"}</button>` : ""}${u.role === "business" && u.business ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="toggleReviewLinks('${u.id}')">Review links</button><div id="rl-edit-${u.id}" style="display:none;margin-top:8px;min-width:260px">${["google", "yelp", "tripadvisor", "facebook"].map((k) => `<div class="field"><label>${esc(k)}</label><input id="rl-${k}-${u.id}" type="url" value="${esc((u.business.reviewLinks || {})[k] || "")}" placeholder="https://"></div>`).join("")}<button class="btn small-btn" onclick="saveReviewLinks('${u.id}')">Save review links</button></div><br><button class="btn small-btn ghost" style="margin-top:6px" onclick="toggleDiscountEditor('${u.id}')">Code discount</button><div id="disc-edit-${u.id}" style="display:none;margin-top:8px;min-width:260px"><label style="font-weight:500"><input type="checkbox" id="disc-enabled-${u.id}" style="width:auto" ${u.business.discountEnabled ? "checked" : ""}> Code discounts on (business's opt-in)</label><div class="field"><label>Discount percent (5 to 50)</label><input id="disc-pct-${u.id}" type="number" min="5" max="50" step="1" value="${esc(String(u.business.discountPct == null ? 20 : u.business.discountPct))}"></div><button class="btn small-btn" onclick="saveDiscountSetting('${u.id}')">Save code discount</button></div>` : ""}${u.role === "creator" ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="adminViewCreator('${u.id}')">View profile</button>` : ""}</td>
      </tr>`;
    };
    const s = data.summary;
    const summaryStrip = s ? `
      <h3>Founding roster counts</h3>
      <p class="muted small">Creators only, counted from the records. Approved + profile complete is the launch number: only those creators show up for businesses.</p>
      <div class="table-wrap panel"><table><tr><th>Market</th><th>Counts</th></tr>
      ${s.markets.map((m) => `<tr><td>${esc(m.label)}</td><td><strong>${m.pending}</strong> pending &middot; <strong>${m.approved}</strong> approved &middot; <strong>${m.approvedComplete}</strong> approved + complete</td></tr>`).join("")}
      <tr><td><strong>All markets</strong></td><td><strong>${s.all.pending}</strong> pending &middot; <strong>${s.all.approved}</strong> approved &middot; <strong>${s.all.approvedComplete}</strong> approved + complete</td></tr>
      </table></div>
      ${s.auto ? `<p class="muted small">Auto-decided under the standing rules: ${s.auto.approved} approved, ${s.auto.rejected} rejected all time; today ${s.auto.approvedToday} approved, ${s.auto.rejectedToday} rejected. Referred claims always wait for a person.</p>` : ""}` : "";
    el.innerHTML = `
      ${summaryStrip}
      <h3>Pending (${data.pending.length})</h3>
      ${data.pending.length ? `<div class="table-wrap panel"><table><tr><th>Applicant</th><th>Type</th><th>Market</th><th>Details</th><th>Applied</th><th>Decision</th></tr>${data.pending.map(row).join("")}</table></div>` : `<p class="muted">No pending applications.</p>`}
      <h3 class="mt">Decided (${data.decided.length})</h3>
      ${data.decided.length ? `<div class="table-wrap panel"><table><tr><th>Applicant</th><th>Type</th><th>Market</th><th>Details</th><th>Applied</th><th>Status</th></tr>${data.decided.map(row).join("")}</table></div>` : `<p class="muted">None yet.</p>`}`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

// Admin profile view (Jeff, 2026-10-26): "View profile" on a
// Requests card opens the applicant's full SIGNL profile exactly
// as a business would see it, including pending applicants the
// public /c/ page cannot show yet. The payload comes from
// GET /admin/creators/:id (the Discover card shape); the renderer
// runs in admin mode, so the only action is the way back.
async function adminViewCreator(userId) {
  const el = document.getElementById("tab-body");
  if (!el) return;
  el.innerHTML = `<p class="muted">Loading profile...</p>`;
  try {
    const data = await api("GET", "/admin/creators/" + encodeURIComponent(userId));
    const c = data.creator;
    if (!c) { el.innerHTML = `<div class="error-box">Creator not found</div>`; return; }
    const statusLine = c.applicationStatus ? `<p class="small"><span class="badge ${c.applicationStatus === "approved" ? "ok" : c.applicationStatus === "rejected" ? "bad" : "info"}">${esc(c.applicationStatus)}</span> <span class="muted">Shown exactly as a business sees this profile.</span></p>` : "";
    el.innerHTML = statusLine + creatorProfileDetailHtml(c, false, { admin: true });
    window.scrollTo(0, 0);
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div><p><button class="btn small-btn ghost" onclick="adminBackToRequests()">Back to Requests</button></p>`;
  }
}

function adminBackToRequests() { loadApplications(); return false; }

async function loadLeaderboard() {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/admin/leaderboard");
    const rows = data.leaderboard || [];
    el.innerHTML = `
      <p class="muted small">Recruiters ranked by Momentum points: +3 for every creator who signs up through their invite link, +10 more when that creator is approved. Points come only from stored sign-up records.</p>
      ${rows.length ? `<div class="table-wrap panel"><table>
        <tr><th>#</th><th>Creator</th><th>Handle</th><th>Market</th><th>Sign-ups via link</th><th>Approved</th><th>Momentum points</th></tr>
        ${rows.map((r, i) => `<tr><td data-label="Rank">${i + 1}</td><td><strong>${esc(r.name)}</strong></td><td>${r.primaryProfileUrl ? `<a href="${esc(r.primaryProfileUrl)}" target="_blank" rel="noopener">@${esc(r.handle)}</a>` : `@${esc(r.handle)}`}</td><td>${esc(r.market)}</td><td data-label="Sign-ups via link">${r.signups}</td><td data-label="Approved">${r.approved}</td><td data-label="Momentum points"><strong>${r.points}</strong></td></tr>`).join("")}
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

// File an unlisted application under the resolver's suggested
// market (Jeff, 2026-10-23): the tap behind the "File under ..."
// button on the applications queue. The server re-derives the
// candidates from the record's typed city and refuses anything
// else, and the typed city stays as the record's home city.
async function fileUnderMarket(userId, market) {
  try {
    await api("POST", "/admin/users/file-market", { userId, market });
    loadApplications();
  } catch (err) { alert(err.message); }
}

// Rejection with an optional reason (audit F4): the Reject button
// opens a small editor carrying the fixed reason categories; the
// picked category rides the review call, is stored on the record,
// and is named in the rejection email the server sends. No reason
// picked sends the same rejection with the generic email line.
function toggleRejectEditor(userId) {
  const el = document.getElementById("rej-edit-" + userId);
  if (el) el.style.display = el.style.display === "none" ? "" : "none";
}

async function confirmRejectApp(userId) {
  const sel = document.getElementById("rej-reason-" + userId);
  const reason = sel ? sel.value : "";
  try {
    await api("POST", "/admin/review", { userId, decision: "reject", ...(reason ? { reason } : {}) });
    loadApplications();
  } catch (err) { alert(err.message); }
}

// Business activation: approval alone leaves a business on the
// founding list. This separate action flips it to full access
// (browse, favorites, drafts); publishing still follows the
// market live flag.
async function activateBusiness(userId) {
  if (!confirm("Activate this business? It gets full product access: browse, favorites, and draft offers. Publishing still follows the market live flag.")) return;
  try {
    await api("POST", "/admin/businesses/activate", { userId });
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

async function setTester(userId, tester, role) {
  const isBiz = role === "business";
  const msg = tester
    ? (isBiz
      ? "They keep full business access for testing, but campaign sends skip them and the tester count in Stats includes them. Their offers and visits keep working."
      : "They keep full creator access for testing, but businesses will not see them, their public profile page comes down, campaign sends skip them, and roster counts exclude them.")
    : (isBiz
      ? "The business leaves the tester set: campaign sends can reach them again and the Stats tester count drops."
      : "Businesses will see them in discovery again, their public profile page returns, and roster counts will include them.");
  const ok = await showConfirmSheet(tester ? `Move this ${isBiz ? "business" : "creator"} to Tester?` : `Move this ${isBiz ? "business" : "creator"} back to the roster?`, msg, tester ? "Move to Tester" : "Move to roster");
  if (!ok) return;
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
      ${data.degraded ? `<div class="error-box">The event log could not be loaded just now. Refresh in a moment; nothing here was changed.</div>` : ""}
      <p class="muted small">${data.total} events, newest first. Every state change in the product writes one of these. This is the dataset.</p>
      <div class="table-wrap panel"><table>
        <tr><th>When</th><th>Type</th><th>Actor</th><th>Market</th><th>Data</th></tr>
        ${data.events.map((e) => `<tr><td class="small" data-label="When">${fmtDate(e.ts)}</td><td><span class="badge info">${esc(e.type)}</span></td><td class="small">${esc(e.actorRole || "")}</td><td class="small">${esc(e.market || "")}</td><td class="small">${esc(JSON.stringify(e.data || {}))}</td></tr>`).join("")}
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
        ${Object.entries(s.perMarket).map(([m, v]) => `<tr><td>${esc(m)}</td><td data-label="Approved creators">${v.creators}</td><td data-label="Approved businesses">${v.businesses}</td><td data-label="Bookings">${v.bookings}</td><td data-label="Posts">${v.posts}</td></tr>`).join("")}
      </table></div>
      ${s.unlistedByCity && s.unlistedByCity.length ? `
      <h3 class="mt">Sign-ups in cities not open yet</h3>
      <p class="muted small">Creators who signed up from outside the listed markets, counted per city and country. This is the demand signal for where to open next.</p>
      <div class="table-wrap panel"><table>
        <tr><th>City, country</th><th>Creator sign-ups</th></tr>
        ${s.unlistedByCity.map((r) => `<tr><td>${esc(r.place)}</td><td data-label="Creator sign-ups">${r.creators}</td></tr>`).join("")}
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
  state.preview = { step: "plans", planId: "self-service", market: "Virginia Beach", creators: null, creator: null, targetId: "", sent: [], confirmation: null, dashboard: null, offersList: null };
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
    staffdemo: "The staff redemption demo: the register flow, simulated end to end",
    offers: "The creator side: the open-offer deck a creator swipes through (simulation)",
  }[pv.step] || "";
  const planName = pv.step === "dashboard" && pv.dashboard
    ? pv.dashboard.plan.name
    : (state.boot.plans.find((p) => p.id === pv.planId) || {}).name || "";
  const navBtn = (step, label) => `<button class="${pv.step === step || (step === "discover" && (pv.step === "profile" || pv.step === "offer")) ? "active" : ""}" onclick="previewNavTo('${step}')">${label}</button>`;
  app.innerHTML = `
  <div class="preview-banner">
    <span class="preview-tag">PREVIEW</span>
    ${pv.step === "offers"
      ? `<span><strong>Previewing as a creator.</strong> These open offers are simulations for testing the deck: applying writes nothing and notifies nobody.</span>`
      : `<span><strong>Previewing as a business.</strong> Everything here is what a business sees. Offers sent in preview are simulations: they never reach a creator and nothing is saved.</span>`}
    <button class="btn small-btn" onclick="exitPreview()">Exit preview</button>
  </div>
  <div class="tabs">${navBtn("plans", "Plans")}${navBtn("discover", "Discover")}${navBtn("dashboard", "Dashboard")}${navBtn("offers", "Creator offers")}</div>
  <p class="muted small">${esc(stepLabel)} &middot; Plan: ${esc(planName)} &middot; Market: ${esc(pv.market)}</p>
  <div id="preview-main"></div>`;
  const main = document.getElementById("preview-main");
  if (pv.step === "plans") main.innerHTML = previewPlansHtml();
  else if (pv.step === "discover") { main.innerHTML = previewDiscoverHtml(); if (pv.creators) renderPreviewResults(); else runPreviewDiscover(); }
  else if (pv.step === "profile" && pv.creator) main.innerHTML = creatorProfileDetailHtml(pv.creator, true);
  else if (pv.step === "offer") main.innerHTML = previewOfferHtml();
  else if (pv.step === "dashboard") { main.innerHTML = pv.dashboard ? previewDashboardHtml(pv.dashboard) : `<section class="panel"><p class="muted">Loading the dashboard...</p></section>`; if (pv.dashboard) startPreviewCountdown(); else loadPreviewDashboard(); }
  else if (pv.step === "staffdemo") main.innerHTML = pvStaffDemoHtml();
  else if (pv.step === "offers") { main.innerHTML = pvOffersHtml(); if (pv.offersList) renderPvBoardShell(); else loadPvOffers(); }
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
      <div class="price">$${fmtPrice(p.priceMonthly)}<span class="small muted">/mo</span></div>
      <div class="founding-badge-row">${foundingBadgeHtml(p)}</div>
      <strong>${esc(p.name)}</strong>
      <p class="small muted">${p.minMonths}-month minimum. Founding rate, locked while your plan stays active.</p>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
    </div>`).join("");
  return `
  <section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> What a business sees first: the founding plans</h3>
    <p class="muted">A business joins the founding list and picks a plan (recorded at sign-up, no card charged during founding); when their market activates, they land in Discover with the founding roster ready. Pick a plan and a market, then walk the roster exactly as they would.</p>
    <div class="field"><label>Market to preview</label><select id="pv-market">${state.boot.markets.map((m) => `<option ${pv.market === m.name ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>
    <div class="plan-cards">${plans}</div>
    <p class="mt"><button class="btn" onclick="previewToDiscover()">Search the roster &rarr;</button>
    <button class="btn ghost" onclick="previewToDashboard()">Open dashboard &rarr;</button></p>
    <p class="small muted">Continue as this business, or skip ahead. Preview discovery works in every market, live or not, so a market can be test-driven before it opens. Real businesses only search their own market once it is live.</p>
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
      <div><label>Sort by</label><select id="pvf-sort"><option value="">Founding order</option><option value="score">Local Impact Score</option><option value="momentum">Momentum (roster standing)</option><option value="fit">Best fit</option></select></div>
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
  return `<section class="panel"><h4 style="margin-top:0">Sent in this preview session (${pv.sent.length})</h4><p class="small muted">Simulations only. Stored nowhere, seen by no creator, counted nowhere.</p>${pv.sent.map((o) => `<p class="small">&middot; <strong>${esc(o.title)}</strong> &rarr; ${o.creatorHandle ? "@" + esc(o.creatorHandle) : "open offer"} &middot; cap $${fmtMoney(o.dollarCap)} &middot; ${esc(o.visitWindow || "Flexible window")}</p>`).join("")}</section>`;
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
  el.innerHTML = `<div id="pv-discover-toggle">${pvDiscoverModeToggleHtml()}</div><div id="pv-discover-body"></div>`;
  renderPvDiscoverBody();
}

// ---------- Preview Discover as a card stack (Jeff, 2026-10-25) ----------
// The preview roster rides the SAME stack engine and the SAME deck
// card as the real business Discover (discoverStackCard: cover
// photo, local reach % as the hero number, the sample-photo pill
// where the preview decoration applies), so the swipe feel tested
// here is the feel businesses get. Invite opens the existing
// preview offer composer, tap opens the existing preview profile
// step, and a pass parks the creator in the preview Later pile
// — the exact semantics of the real decks. Preview stays a
// simulation end to end: the deck writes nothing and no real
// /discover state is touched. List mode keeps the roster grid this
// step has always rendered.
function pvDiscoverModeToggleHtml() {
  const mode = state.pvDiscoverMode || "cards";
  return `<div class="view-toggle"><div class="vt-group"><button type="button" class="rchip${mode === "cards" ? " on" : ""}" onclick="setPvDiscoverMode('cards')">Cards</button><button type="button" class="rchip${mode === "list" ? " on" : ""}" onclick="setPvDiscoverMode('list')">List</button></div>${deckChromeHtml("pvdiscover")}<span class="stack-pos" data-stackpos="pvdiscover"></span></div>${deckTeachHtml("pvdiscover")}`;
}
function setPvDiscoverMode(mode) {
  state.pvDiscoverMode = mode;
  const tg = document.getElementById("pv-discover-toggle");
  if (tg) tg.innerHTML = pvDiscoverModeToggleHtml();
  renderPvDiscoverBody();
  return false;
}
function renderPvDiscoverBody() {
  const el = document.getElementById("pv-discover-body");
  if (!el || !state.preview) return;
  const all = state.preview.creators || [];
  const q = deckQueue("pvdiscover", all);
  if (!q.visible.length && all.length) {
    const pos = document.querySelector('[data-stackpos="pvdiscover"]');
    if (pos) pos.textContent = "";
    el.innerHTML = `<div class="stk-end"><h3>Nothing new in this preview search</h3><p class="small muted">Everyone here is parked in your Later pile or hidden.</p><div class="stk-end-actions">${q.parked.length ? `<button type="button" class="btn ghost" onclick="openLaterPile('pvdiscover')">Review Later (${q.parked.length})</button>` : ""}<button type="button" class="btn" onclick="runPreviewDiscover()">Search again</button></div></div>`;
    syncDeckChrome("pvdiscover");
    return;
  }
  if ((state.pvDiscoverMode || "cards") === "list") {
    const pos = document.querySelector('[data-stackpos="pvdiscover"]');
    if (pos) pos.textContent = "";
    el.innerHTML = `<div class="creator-grid">${q.visible.map((c) => creatorCard(c, state.user, { preview: true })).join("")}</div>`;
    syncDeckChrome("pvdiscover");
    return;
  }
  if (!stackState.pvdiscover || stackState.pvdiscover.src !== all) {
    stackState.pvdiscover = startDeck("pvdiscover", all, {
      cardHtml: (c) => discoverStackCard(c),
      goLabel: "Invite",
      onGo: (c) => { pileUnlater("pvdiscover", c.userId); previewStartOffer(c.userId); },
      onPass: (c) => { pileLater("pvdiscover", c.userId); },
      onTap: (c) => { previewViewCreator(c.userId); },
      endHtml: (passed, total) => pvDiscoverEndHtml(passed, total),
    });
  }
  el.innerHTML = `<div class="stk-wrap" data-stack="pvdiscover"></div>`;
  renderStack(el.firstElementChild);
  syncDeckChrome("pvdiscover");
}
function pvDiscoverEndHtml(passed, total) {
  const q = deckQueue("pvdiscover", (stackState.pvdiscover && stackState.pvdiscover.src) || []);
  const n = q.parked.length;
  const seen = q.visible.length;
  return `<div class="stk-end"><h3>That's everyone in this preview search</h3><p class="small muted">You looked through ${seen} creator${seen === 1 ? "" : "s"}. Later piles live only in this preview session, and invites open the simulated composer: nothing reaches a real creator.</p><div class="stk-end-actions">${n ? `<button type="button" class="btn ghost" onclick="openLaterPile('pvdiscover')">Review Later (${n})</button>` : ""}<button type="button" class="btn" onclick="runPreviewDiscover()">Search again</button></div></div>`;
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
  // Two-tap parity (Jeff, 2026-10-26): a DIRECT preview offer
  // opens prefilled exactly like the live composer: the tier's
  // lead comp suggestion as title + comped + cap, its chip
  // selected, on the same lane defaults (comp, 7 days, 1 spot).
  const pvSug = target ? compSuggestions(target.profile ? target.profile.tierBand : null)[0] : null;
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
      <div class="field"><label>Offer title</label><input id="pvo-title" required placeholder="For example: Dinner for two on us"${pvSug ? ` value="${esc(pvSug.label)}"` : ""}></div>
      <div class="field"><label>Exactly what is comped</label><input id="pvo-comped" required placeholder="For example: Two entrees and two drinks for the creator and a guest"${pvSug ? ` value="${esc(pvSug.comp)}"` : ""}>${chipsRowHtml("comp", "pvo", target && target.profile ? target.profile.tierBand : null, pvSug ? { comp: pvSug.comp, cap: pvSug.cap } : null)}</div>
      <div class="field"><label>How many people does the comp cover?</label>
        <div class="radio-stack">
        <label class="radio-chip"><input type="radio" name="pvo-covers" value="1" checked><span>1 person: just the creator</span></label>
        <label class="radio-chip"><input type="radio" name="pvo-covers" value="2"><span>2 people: the creator and a guest</span></label>
        </div>
      </div>
      <div class="form-2col">
        <div class="field"><label>Dollar cap ($)</label><input type="number" id="pvo-cap" min="1" required placeholder="75"${pvSug ? ` value="${pvSug.cap}"` : ""}></div>
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
      covers: parseInt((document.querySelector("input[name='pvo-covers']:checked") || {}).value, 10) || 1,
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
    if (pv.wantStaffDemo) { pv.wantStaffDemo = false; return pvStaffEnter(); }
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
    <p class="small muted">@${esc(b.creatorHandle)} (${esc(b.creatorName)})${b.creatorTier ? ` &middot; ${esc(b.creatorTier)}` : ""} &middot; ${esc(marketDisplayName(b.market))} &middot; Comp: ${esc(b.whatComped)} (cap $${fmtMoney(b.dollarCap)}${b.compCostModeled ? `, at cost $${fmtMoney(b.compCostModeled)} modeled` : ""})${b.kind === "paid" ? "" : ` &middot; ${coversLine(b)}`} &middot; Window: ${esc(b.visitWindow || "Flexible")}</p>`;
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
    <button class="btn small-btn" disabled>Request replacement</button> <span class="small muted">In the live app this asks SIGNL for a replacement creator for the burned visit. Disabled in preview.</span>`;
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
      <button class="btn small-btn ghost" type="submit">Preview score</button>
      <span class="small" id="pv-redeem-result-${b.id}"></span>
      <p class="small muted">Simulation only: in the live app the business reports this tally on the visit and it is saved. Here nothing is recorded, and the dashboard keeps its original tallies.</p>
    </form>`;
    html += b.kind === "paid"
      ? `<button class="btn small-btn ghost" disabled>Use in an ad</button> <span class="small muted">Ad use comes with the standard license: this paid visit includes repost plus ads for 90 days from the post date; the creator is notified and earns +25 Momentum. Disabled in preview; try it live from a paid visit.</span>`
      : `<button class="btn small-btn ghost" disabled>License for ads</button> <span class="small muted">This was a comp visit: native sharing only until licensed. In the live app, the business can license this post for 90 days of repost and ad use at the creator's listed licensing fee, only with their approval. Disabled in preview.</span>`;
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
  const demo = d.staffDemo || null;
  return `
  <section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> What staff see at the counter</h3>
    <p class="muted small">The Counter screen: code or QR, one tap redeems, the 48h clock starts. The register is never involved.</p>
    ${demo ? `
    <div class="notice blue">
      <strong>Try the staff login yourself (simulation).</strong> This demo runs the full staff flow against ${esc(demo.businessName)} in preview: PIN screen, code lookup, redeem. Nothing is saved and no real record changes.
      <div class="grid cols-2" style="margin-top:10px">
        <p class="small" style="margin:0"><strong>Business (staff) code:</strong> <span class="code">${esc(demo.staffCode)}</span><br><strong>Register link:</strong> ${esc(demo.registerPath)}<br><strong>Demo staff PIN:</strong> <span class="code">${esc(demo.demoPin)}</span></p>
        <p class="small" style="margin:0"><strong>Sample creator code to redeem:</strong> <span class="code">${esc(demo.redeemCode || "")}</span><br><span class="muted">${demo.redeemVisit ? `${esc(demo.redeemVisit.title)} with @${esc(demo.redeemVisit.creatorHandle)} &middot; ${coversLine(demo.redeemVisit)}` : ""}</span></p>
      </div>
      <div class="cta-row" style="justify-content:flex-start;margin-top:10px">
        <button class="btn" onclick="return pvStaffEnter()">Open staff demo</button>
      </div>
      <div class="field" style="margin-top:10px;max-width:340px"><label>Set your own demo PIN for this session (4 to 6 digits)</label><input id="pv-demo-pin" inputmode="numeric" maxlength="6" placeholder="${esc(demo.demoPin)}"></div>
      <button class="btn small-btn ghost" onclick="return pvStaffSetPin()">Use this PIN</button> <span id="pv-demo-pin-ok" class="saved"></span>
      <p class="small muted" style="margin-bottom:0">Live: the owner sets the real PIN on the Plan tab. This demo PIN exists only in preview.</p>
    </div>` : ""}
    <div class="grid cols-2">
      <div class="card">
        <div class="field"><label>Booking code</label><input value="${esc(booked.code)}" disabled style="text-transform:uppercase;font-family:Manrope;font-weight:700;letter-spacing:0.06em"></div>
        <div class="card" style="margin-top:10px">
          <div class="flex-between"><strong>${esc(booked.creatorName)}</strong><span class="badge tier">@${esc(booked.creatorHandle)}</span></div>
          <p class="small">${esc(booked.title)}: ${esc(booked.whatComped)}</p>
          <p class="small muted">Comp cap $${fmtMoney(booked.dollarCap)} &middot; ${coversLine(booked)} &middot; Window: ${esc(booked.visitWindow || "Flexible")} &middot; Code ${esc(booked.code)}</p>
          <p class="small">Check the person in front of you matches the creator, then redeem. The code burns and the 48 hour post clock starts now.</p>
          <button class="btn" style="width:100%" onclick="return pvStaffEnter()">Try it in the demo above</button>
          <p class="small muted" style="margin-bottom:0">The live Redeem button is disabled on this read-only card; the demo at the top of this panel runs the real flow in simulation.</p>
        </div>
      </div>
      <div>
        ${redeemed ? `<div class="error-box">This code was already redeemed at ${esc(fmtDate(redeemed.redeemedAt))}. Codes work once.</div>
        <p class="small muted">That is what staff see if a burned code is entered again, here for ${esc(redeemed.title)} (@${esc(redeemed.creatorHandle)}). One code, one visit, no double comps. Try it in the demo: enter this code after the PIN.</p>` : ""}
        <div class="card">
          <strong>No code? No problem.</strong>
          <p class="small">If the creator is standing there but the code cannot be scanned, staff confirm the visit from the booking instead. The same 48 hour clock starts, and the booking is marked "business confirmed", like the Sunday supper club visit in the list below. The creator also gets an "I am here" check-in button on their side.</p>
        </div>
      </div>
    </div>
  </section>`;
}

// ---------------- preview staff demo (simulation) ----------------
// Jeff presents with the Preview example accounts (2026-10-20):
// the staff PIN login, runnable end to end without touching a
// real record. The demo state lives ONLY in state.preview.pvStaff
// (in memory, gone on exit or reload). The PIN is the seeded demo
// PIN from the dashboard payload, or one Jeff sets for the session
// in the staff panel above. Lookup knows exactly two answers: the
// sample redeemable code from the payload (redeemable once per
// demo run), and any already-burned sample code (the "codes work
// once" answer). Everything else is the plain unknown-code answer,
// worded like the real flow's.
function pvStaffDemoData() {
  const pv = state.preview;
  return pv && pv.dashboard ? pv.dashboard.staffDemo : null;
}

function pvStaffSession() {
  const pv = state.preview;
  if (!pv.pvStaff) {
    const demo = pvStaffDemoData();
    pv.pvStaff = { step: "pin", pin: demo ? demo.demoPin : "2468", redeemed: false, fails: 0, found: null, error: "" };
  }
  return pv.pvStaff;
}

function pvStaffEnter() {
  const pv = state.preview;
  if (!pv) return false;
  if (!pv.dashboard) { previewToDashboard(); return false; }
  if (!pv.pvStaff) pvStaffSession();
  pv.step = "staffdemo";
  renderPreview();
  window.scrollTo(0, 0);
  return false;
}

function pvStaffSetPin() {
  const el = document.getElementById("pv-demo-pin");
  const ok = document.getElementById("pv-demo-pin-ok");
  const v = el ? el.value.trim() : "";
  if (!/^\d{4,6}$/.test(v)) { if (ok) ok.textContent = "Use 4 to 6 digits."; return false; }
  const s = pvStaffSession();
  s.pin = v;
  if (ok) ok.textContent = `Demo PIN set to ${v} for this preview session.`;
  return false;
}

function pvStaffDemoHtml() {
  const demo = pvStaffDemoData();
  if (!demo) return `<section class="panel"><p class="muted">Loading the staff demo...</p></section>`;
  const s = pvStaffSession();
  const banner = `<div class="notice blue"><strong>Preview simulation.</strong> You are staff at ${esc(demo.businessName)} for the next minute. Nothing here is saved, and no real record changes. <a href="#" onclick="return pvStaffExit()">Back to the dashboard</a></div>`;
  if (s.step === "pin") {
    return `
    <section class="panel" style="max-width:520px;margin:10px auto">
      <h2 style="margin-top:0">Staff sign-in</h2>
      ${banner}
      <p class="muted">${esc(demo.businessName)}. Staff: enter the PIN your manager set, then the creator's code.</p>
      <form onsubmit="return pvStaffPinSubmit(event)">
        <div class="field"><label>Business code</label><input value="${esc(demo.staffCode)}" disabled style="text-transform:uppercase;font-family:Manrope;font-weight:700;letter-spacing:0.06em"></div>
        <div class="field"><label>Staff PIN</label><input id="pv-staff-pin" type="password" inputmode="numeric" autocomplete="off" placeholder="The demo PIN is ${esc(s.pin)}" required></div>
        <div id="pv-staff-error">${s.error ? `<div class="error-box">${esc(s.error)}</div>` : ""}</div>
        <button class="btn" type="submit" style="width:100%">Open the code screen</button>
      </form>
      <p class="small muted">Demo PIN for this session: <span class="code">${esc(s.pin)}</span> (seeded ${esc(demo.demoPin)}; change it in the staff panel on the dashboard).</p>
    </section>`;
  }
  if (s.step === "code") {
    const v = demo.redeemVisit || {};
    return `
    <section class="panel" style="max-width:520px;margin:10px auto">
      <h2 style="margin-top:0">Redeem a creator visit</h2>
      ${banner}
      <p class="muted">${esc(demo.businessName)} &middot; staff mode. Enter the creator's code, or scan their QR in the live app.</p>
      <form onsubmit="return pvStaffLookup(event)">
        <div class="field"><label>Creator's visit code</label><input id="pv-staff-code" style="text-transform:uppercase;font-family:Manrope;font-weight:700;letter-spacing:0.06em" autocomplete="off" placeholder="SGNL-XXXXXX" required></div>
        <div id="pv-staff-error">${s.error ? `<div class="error-box">${esc(s.error)}</div>` : ""}</div>
        <button class="btn" type="submit" style="width:100%">Find the visit</button>
      </form>
      <p class="small muted">Try the sample code <span class="code">${esc(demo.redeemCode || "")}</span> (${esc(v.title || "the booked visit")}${v.creatorHandle ? `, @${esc(v.creatorHandle)}` : ""}). ${demo.burnedExample ? `Or try the already-used code <span class="code">${esc(demo.burnedExample.code)}</span> to see the codes-work-once answer.` : ""}</p>
      ${s.found ? pvStaffFoundHtml(s.found) : ""}
      <p class="mt"><button class="btn ghost" onclick="return pvStaffExit()">Back to dashboard</button></p>
    </section>`;
  }
  return `
  <section class="panel center" style="max-width:520px;margin:10px auto">
    <h2 style="margin-top:0">Visit redeemed</h2>
    ${banner}
    <p><strong>${esc(s.redeemedName || "The creator")}</strong> is redeemed in this simulation. Their 48 hour post clock would start now, and the owner would get the staff notice email.</p>
    <p class="muted">In the live app the code burns for real. Here nothing was saved: run it again any time.</p>
    <button class="btn" onclick="return pvStaffAgain()">Redeem another</button>
    <button class="btn ghost" onclick="return pvStaffExit()">Back to dashboard</button>
    <p class="small muted">Redeem another takes you back to the code screen.</p>
  </section>`;
}

function pvStaffFoundHtml(found) {
  if (found.state === "burned") {
    return `<div class="error-box" style="margin-top:12px">This code was already redeemed. Codes work once.</div>`;
  }
  if (found.state === "redeemed") {
    return `<div class="notice" style="margin-top:12px"><strong>Already redeemed in this demo.</strong> The code burned when you redeemed it above. Exit the demo and re-enter to run it again.</div>`;
  }
  const v = found.visit;
  return `
  <div class="card" style="margin-top:12px">
    <div class="flex-between"><strong>${esc(v.creatorName)}</strong><span class="badge tier">@${esc(v.creatorHandle)}</span></div>
    <p class="small">${esc(v.title)}: ${esc(v.whatComped)}</p>
    <p class="small muted">Comp cap $${fmtMoney(v.dollarCap)} &middot; ${coversLine(v)} &middot; Visit: ${esc(v.visitWindow || "Flexible")}${v.redeemBy ? ` &middot; Redeem by ${fmtDate(v.redeemBy)}` : ""}</p>
    <p class="small">Check the person in front of you matches the creator, then redeem. The code burns and the 48 hour post clock starts now.</p>
    <button class="btn" style="width:100%" onclick="return pvStaffRedeem()">Redeem and start the clock</button>
  </div>`;
}

function pvStaffPinSubmit(e) {
  e.preventDefault();
  const s = pvStaffSession();
  const v = (document.getElementById("pv-staff-pin") || {}).value || "";
  if (v !== s.pin) {
    s.fails += 1;
    s.error = s.fails >= 5 ? "Too many wrong PINs. In the live app this locks staff entry for 15 minutes; the demo just asks you to try the demo PIN shown below." : "That PIN is not right for this business. Try again.";
    renderPreview();
    return false;
  }
  s.error = "";
  s.step = "code";
  renderPreview();
  window.scrollTo(0, 0);
  return false;
}

function pvStaffLookup(e) {
  e.preventDefault();
  const demo = pvStaffDemoData();
  const s = pvStaffSession();
  const code = (((document.getElementById("pv-staff-code") || {}).value) || "").trim().toUpperCase();
  s.error = "";
  if (demo.redeemCode && code === demo.redeemCode) {
    s.found = s.redeemed ? { state: "redeemed" } : { state: "ok", visit: demo.redeemVisit };
  } else if (demo.burnedExample && code === demo.burnedExample.code) {
    s.found = { state: "burned" };
  } else {
    s.found = null;
    s.error = "We could not find that code. Check the code on the creator's phone and try again.";
  }
  renderPreview();
  return false;
}

function pvStaffRedeem() {
  const s = pvStaffSession();
  const demo = pvStaffDemoData();
  s.redeemed = true;
  s.redeemedName = demo && demo.redeemVisit ? `${demo.redeemVisit.creatorName} (@${demo.redeemVisit.creatorHandle})` : "The creator";
  s.step = "done";
  s.found = null;
  renderPreview();
  window.scrollTo(0, 0);
  return false;
}

function pvStaffAgain() {
  const s = pvStaffSession();
  s.step = "code";
  s.error = "";
  renderPreview();
  return false;
}

function pvStaffExit() {
  const pv = state.preview;
  if (pv) { pv.step = "dashboard"; pv.pvStaff = null; }
  renderPreview();
  window.scrollTo(0, 0);
  return false;
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
      <strong>@${esc(pb.creatorHandle)}</strong> (${esc(pb.creatorName)}) &middot; paid visit at their listed rate of $${fmtPrice(pb.rate)}<br>
      <span class="small">Business paid $${fmtMoney(pb.businessTotal)} (rate + 3%) &middot; creator receives $${fmtMoney(pb.creatorNet)} &middot; SIGNL fee $${fmtMoney(pb.platformFee)}, split evenly &middot; ${pb.escrowState === "released" ? `<span class="badge ok">Escrow released</span>` : `<span class="badge info">Escrow held</span>`} <span class="muted">${esc(pb.escrowNote)}</span></span>
    </div>`).join("");
  return `
  <section class="panel">
    <div class="flex-between">
      <div><h3 style="margin:0">${esc(mv.business.name)}</h3><p class="muted small" style="margin:4px 0 0">${esc(mv.business.category)} &middot; ${esc(marketDisplayName(mv.business.market))} &middot; a second simulated business, shown so the Managed budget has somewhere honest to live</p></div>
      <span class="badge info">${esc(mv.plan.name)} plan &middot; $${fmtPrice(mv.plan.priceMonthly)}/mo &middot; ${mv.plan.visitsPerMonth} visits/mo</span>
    </div>
    <h4>Monthly creator talent budget</h4>
    <div class="stat-row">
      <div class="stat"><div class="num">$${fmtMoney(b.monthlyTalentBudget)}</div><div class="lbl">Budget set for the month</div></div>
      <div class="stat"><div class="num">$${fmtMoney(b.spentThisMonth)}</div><div class="lbl">Spent on paid bookings</div></div>
      <div class="stat"><div class="num">$${fmtMoney(b.remaining)}</div><div class="lbl">Remaining this month</div></div>
    </div>
    <p class="small muted">${esc(b.note)}</p>
    ${mv.discountCodes && !mv.discountCodes.enabled ? `<p class="small muted"><strong>Audience-code discounts: off.</strong> Codes count customers only. Turning discounts on, and the %, is the business's call.</p>` : ""}
    ${rows || `<p class="small muted">No paid bookings yet this month.</p>`}
    <p class="small muted">Paid lane: a creator at their listed rate, 6% total split evenly (business +3%, creator keeps 97%). Comp-only is always fine. ${b.paidBookings && b.paidBookings.length ? esc(b.paidBookings[0].paymentNote) : ""}</p>
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
// The preview twin of Business Home, built from the SAME
// segment builders as the live dashboard (bizDash* above), so
// the two stay in sync. Returns one fragment per segment; the
// preview dashboard composes them with its booking cards.
function pvHomeHtml(d) {
  const h = d.home;
  const empty = { overview: "", activity: "", offers: "", analytics: "" };
  if (!h) return empty;
  const content = bizDashContentRowsHtml(h);
  const next = bizDashNextRowsHtml(h, true);
  return {
    overview: `
  <section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> Business home</h3>
    ${bizDashPipelineHtml(h)}
    ${bizDashPaceHtml(h, d.plan.name)}
  </section>`,
    activity: `
  <section class="panel">
    <h3 style="margin-top:0">Activity</h3>
    <h4>Needs you</h4>
    ${bizDashAttentionHtml(h, {})}
    <h4 style="margin:20px 0 0">Latest</h4>
    ${bizActivityFeedHtml(h)}
  </section>`,
    offers: `
  <section class="panel">
    <h3 style="margin-top:0">Offers</h3>
    ${next ? `<h4>Next visits</h4>${next}` : `<p class="small muted">No visits booked yet.</p>`}
    <h4 style="margin:18px 0 0">Start an offer</h4>
    ${bizTemplatesHtml()}
  </section>`,
    analytics: `
  <section class="panel">
    <h3 style="margin-top:0">Analytics</h3>
    <div class="ana-block"><h4>Invite to post funnel</h4>${bizFunnelHtml(h)}</div>
    ${content ? `<div class="ana-block"><h4>Content that is working</h4>
${content}</div>` : ""}
    <div class="ana-block"><h4>Content library</h4>${bizLibraryHtml(h)}</div>
  </section>`,
  };
}

function previewDashboardHtml(d) {
  const s = d.summary;
  const plan = d.plan;
  if (!d.bookings || !d.bookings.length) {
    return `<section class="panel"><h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> The business dashboard</h3><p class="muted">No approved creators yet, so there is no roster to simulate bookings over. Approve founding creators and the dashboard fills in.</p></section>`;
  }
  const home = pvHomeHtml(d);
  const overdue = d.bookings.filter((b) => b.state === "overdue");
  const delivered = d.bookings.filter((b) => b.state === "posted_on_time" || b.state === "posted_late");
  const active = d.bookings.filter((b) => b.state !== "overdue" && b.state !== "posted_on_time" && b.state !== "posted_late");
  const needsCount = ((d.home && d.home.attention) ? d.home.attention.length : 0) + overdue.length;
  return `
  <div data-dash>
  <section class="panel">
    <div class="flex-between">
      <div><h3 style="margin:0">${esc(d.business.name)}</h3><p class="muted small" style="margin:4px 0 0">${esc(d.business.category)} &middot; ${esc(marketDisplayName(d.business.market))} &middot; ${esc(s.cycleLabel)} cycle</p></div>
      <span class="badge info">${esc(plan.name)} plan &middot; $${fmtPrice(plan.priceMonthly)}/mo &middot; ${plan.visitsPerMonth} visits/mo</span>
    </div>
    <p class="small muted" style="margin-bottom:0">Simulated over the real founding roster. Nothing is saved; no creator is contacted.</p>
  </section>
  <section class="panel">
    <div class="stat-band home-metrics">
      <div class="stat-cell"><div class="stat-num"><em>${fmtNum(d.home && d.home.localReachDelivered ? d.home.localReachDelivered : 0)}</em></div><div class="stat-lbl">Local reach delivered</div></div>
      <div class="stat-cell"><div class="stat-num">${s.visitsUsed}<span class="small muted"> of ${s.visitsAllowance}</span></div><div class="stat-lbl">Visits booked this month &middot; ${s.visitsRemaining} left</div></div>
      <div class="stat-cell"><div class="stat-num">${s.postsDelivered}</div><div class="stat-lbl">Posts live</div></div>
      <div class="stat-cell"><div class="stat-num grad-text">${s.roas && s.roas.score !== null ? s.roas.score.toFixed(2) + "&times;" : "n/a"}</div><div class="stat-lbl">SIGNL ROAS Score</div></div>
    </div>
  </section>
  ${dashSegsHtml(needsCount)}
  <div data-seg="overview">
    ${home.overview}
    ${pvStaffPanelHtml(d)}
  </div>
  <div data-seg="activity" hidden>
    ${home.activity}
    ${overdue.length ? `<section class="panel"><h3 style="margin-top:0">Overdue visits (${overdue.length})</h3>${overdue.map((b) => pvBookingCard(b)).join("")}</section>` : ""}
  </div>
  <div data-seg="offers" hidden>
    ${home.offers}
    ${active.length ? `<section class="panel"><h3 style="margin-top:0">Active bookings (${active.length})</h3>${active.map((b) => pvBookingCard(b)).join("")}</section>` : ""}
    ${d.managedView ? pvManagedHtml(d.managedView) : ""}
  </div>
  <div data-seg="analytics" hidden>
  <section class="panel">
    <h3 style="margin-top:0">Tracking and returns, ${esc(s.cycleLabel)}</h3>
    <div class="stat-row">
      <div class="stat"><div class="num">${s.visitsUsed}<span class="small muted"> of ${s.visitsAllowance}</span></div><div class="lbl">Visits booked this month</div></div>
      <div class="stat"><div class="num">${s.postsDelivered}</div><div class="lbl">Posts delivered</div></div>
      <div class="stat"><div class="num">${s.onTimeRatePct === null ? "n/a" : s.onTimeRatePct + "%"}</div><div class="lbl">On-time rate (${s.postsOnTime} on time, ${s.postsLate} late)</div></div>
      <div class="stat"><div class="num">${fmtNum(s.totalViews)}</div><div class="lbl">Total content views</div></div>
      <div class="stat"><div class="num">$${fmtMoney(s.compValueGiven)}</div><div class="lbl">Comp given, at cost (modeled)</div></div>
    </div>
    <p class="small muted">${s.postsInFlight} in flight &middot; ${s.postsOverdue} overdue &middot; ${s.visitsRemaining} visits left. ${esc(s.compValueBasis)}.</p>
    ${s.roas ? `
    <div class="showcase-block"><h4>${esc(s.roas.label)}</h4>
      <div class="stat-row">
        <div class="stat"><div class="num grad-text">${s.roas.score === null ? "n/a" : s.roas.score.toFixed(2) + "&times;"}</div><div class="lbl">SIGNL ROAS Score</div></div>
        <div class="stat"><div class="num grad-text">${s.roas.allInScore === null ? "n/a" : s.roas.allInScore.toFixed(2) + "&times;"}</div><div class="lbl">All-in, with the plan counted</div></div>
        <div class="stat"><div class="num">$${fmtMoney(s.roas.registerValue)}</div><div class="lbl">Register value, tracked through creator codes (${s.roas.redemptions.count} redemptions, $${fmtMoney(s.roas.redemptions.basketTotal)} rung up)</div></div>
        <div class="stat"><div class="num">$${fmtMoney(s.roas.mediaValue)}</div><div class="lbl">Media value, modeled at the published rates</div></div>
        <div class="stat"><div class="num">$${fmtMoney(s.roas.compCost + s.roas.discountCost)}</div><div class="lbl">Visit costs: $${fmtMoney(s.roas.compCost)} comps at cost + $${fmtMoney(s.roas.discountCost)} code discounts</div></div>
      </div>
      <p class="small muted" style="margin-bottom:0">${esc(s.roas.registerBasis)} ${esc(s.roas.mediaBasis)}${s.roas.planKnown ? ` The all-in score also counts the ${esc(plan.name)} plan allocation of $${fmtMoney(s.roas.planAllocation)} across the delivered visits.` : ""}</p>
      ${d.business.discountCodes && d.business.discountCodes.enabled ? `<p class="small" style="margin-bottom:0"><strong>Audience-code discounts: on.</strong> ${d.business.discountCodes.pct}% off, the business's call. Tallies above carry the discount cost.</p>` : ""}
    </div>` : ""}
    <div class="showcase-block"><h4>Content rights: they follow the visit</h4>
      <p class="small" style="margin:0 0 4px"><span class="rules">On a comp visit (every plan, including ${esc(plan.name)}):</span> share a delivered post natively, with the creator tagged. No downloads, no reposting the file, no ads.</p>
      <p class="small" style="margin:0 0 4px"><span class="rules">On a paid visit:</span> you can also repost the post on your own feed and run it as an ad for 90 days from the post date.</p>
      <p class="small muted" style="margin:0">Rights follow the visit, not the plan. The creator always owns their content.</p>
    </div>
  </section>
    ${home.analytics}
    ${delivered.length ? `<section class="panel"><h3 style="margin-top:0">Delivered (${delivered.length})</h3>${delivered.map((b) => pvBookingCard(b)).join("")}<p class="small muted">In the live app these live in Visits &amp; Posts, fed by real bookings, codes and proof links.</p></section>` : ""}
  </div>
  </div>`;
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
    const srcParam = params.get("src");
    if (srcParam) {
      try { localStorage.setItem("signl_src", srcParam.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40)); } catch (e) { /* storage unavailable */ }
    }
    // A password reset link (/?reset=<token>) lands on the reset
    // screen ahead of every other interpretation of the URL.
    const resetParam = params.get("reset");
    if (resetParam) {
      state.resetToken = resetParam.trim().slice(0, 128);
      state.view = "reset";
    }
    const claim = parseClaimParams(params);
    if (claim.handle || claim.market || claim.tier || claim.platform) {
      state.prefill = claim;
      // A claim link is an invitation to the form itself: a logged-out
      // visitor lands on the sign-up, pre-filled. Signed-in visitors
      // keep their normal landing, and nothing ever auto-submits.
      if (!state.user) state.view = "join-creator";
    }
    // A prebuilt business-wave link lands a logged-out business
    // on the founding registration with its fields already
    // filled in (Jeff, 2026-10-23). Same rule as claim links:
    // prefill only, never a submit, signed-in visitors keep
    // their normal landing. A creator claim link carries &market=
    // too, so this block must never run when a claim handle is
    // present: the handle makes the URL a creator claim, and the
    // business landing must not override it (bug fix, 2026-10-25:
    // /claim?handle=X&market=Y rendered join-business).
    // Market ALONE is not a business signal either: the site's
    // city and inbound pages point their creator CTAs ("Claim
    // your founding spot") at /?market=<name>&src=inbound-*, so a
    // market-only arrival belongs to the creator landing the
    // claim block above already chose. The business landing needs
    // a business fact: the wave link's name or category, or the
    // business-wave source tag itself (perfection pass, 2026-10-26).
    const bizParams = parseBizParams(params);
    if (!claim.handle && (bizParams.businessName || bizParams.category || (srcParam || "").trim().toLowerCase() === "business-wave")) {
      state.bizPrefill = bizParams;
      if (!state.user) state.view = "join-business";
    }
    // The listing proof sheet (/c/<handle>/proof) is matched
    // before the plain profile: same public payload, print-first
    // rendering.
    const proofMatch = location.pathname.match(/^\/c\/([^/]+)\/proof\/?$/);
    if (proofMatch) {
      let h = proofMatch[1];
      try { h = decodeURIComponent(h); } catch (e) { /* keep raw */ }
      state.publicHandle = h.trim().replace(/^@/, "").slice(0, 40) || h;
      state.view = "public-proof";
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
    // A register card link (/redeem/<staff code>) opens the staff
    // screen pre-identified to that business, whatever else the
    // URL carried. The PIN is still asked every shift.
    const redeemMatch = location.pathname.match(/^\/redeem\/([^/]+)\/?$/);
    if (redeemMatch) {
      let sc = redeemMatch[1];
      try { sc = decodeURIComponent(sc); } catch (e) { /* keep raw */ }
      state.staffCode = sc.trim().toUpperCase().slice(0, 12);
      state.view = "staff";
    }
    const code = params.get("code");
    if (code && state.user && state.user.role === "business") {
      state.tab = "Counter";
      state.counterCode = code.toUpperCase();
      state.view = "dashboard";
    }
    // Stripe Connect return landings (2026-10-26): Stripe's
    // hosted pages bounce back here with ?payouts=return (or
    // refresh) for creators and ?card=saved for businesses.
    // Refresh the affected state, confirm in plain words, land
    // on the tab that owns the surface, and strip the param so
    // a reload does not re-run the landing.
    const payoutsParam = params.get("payouts");
    if (payoutsParam && state.user && state.user.role === "creator") {
      try {
        const d = await api("GET", "/me/payouts");
        if (d && d.payouts && state.user.creator) state.user.creator.payouts = d.payouts;
        setTimeout(() => showToast(d && d.payouts && d.payouts.ready ? "Payouts ready" : "Payout setup saved. Finish it any time under Profile."), 400);
      } catch (e) { /* the lane section on Profile shows the same state */ }
      state.tab = "Profile";
      state.view = "dashboard";
    }
    const cardParam = params.get("card");
    if (cardParam && state.user && state.user.role === "business") {
      try {
        const me2 = await api("GET", "/auth/me");
        if (me2 && me2.user) state.user = me2.user;
      } catch (e) { /* the Plan tab re-reads the record on save anyway */ }
      if (cardParam === "saved") setTimeout(() => showToast(cardOnFileView() ? "Card saved" : "Card step finished. If Stripe saved it, it shows under Plan."), 400);
      state.tab = "Plan";
      state.view = "dashboard";
    }
    if (payoutsParam || cardParam) { try { history.replaceState(null, "", location.pathname); } catch (e) { /* cosmetic only */ } }
    render();
    if (state.user) refreshBadges();
    if (code && state.user && state.user.role === "business" && state.tab === "Counter") {
      setTimeout(() => renderCounter(code.toUpperCase()), 60);
    }
  } catch (e) {
    app.innerHTML = `<div style="max-width:560px;margin:40px auto"><div class="error-box">SIGNL could not load. ${esc(e.message)}</div><p class="mt"><button class="btn" onclick="location.reload()">Reload</button></p></div>`;
  }
})();
