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
function applyProfileShareShell(p, place) {
  document.title = `${p.name} (@${p.handle}) on SIGNL${place ? ` | ${place}` : ""}`;
  const desc = `${p.name} is a founding creator on SIGNL in ${place || "their market"}${p.tierBand ? ` (${p.tierBand} tier)` : ""}. Local businesses comp creators for honest posts.`;
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
  document.head.querySelectorAll("meta[data-signl-meta]").forEach((el) => el.remove());
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
        ${p.paidRate ? `<span class="cc-paid">Paid bookings: $${fmtPrice(p.paidRate)}</span>` : ""}
      </div>
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
    ${p.paidRate ? `<p class="small muted">Books at $${fmtPrice(p.paidRate)} &middot; creator keeps 97% &middot; held until the post is live.</p>` : ""}
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
      <a class="btn ghost" href="/c/${encodeURIComponent(p.handle)}">Back to the public profile</a>
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
      <span class="earn-label">${esc(item.label)}${item.required ? ` <span class="badge info">Needed</span>` : ""}${item.detail ? ` <span class="muted">(${esc(item.detail)})</span>` : ""}</span>
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
// fly off past it. Buttons run the same animations. The stack is
// presentation only: pass just advances locally, and the primary
// action calls the exact handler the list view's button called.
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
    wrap.innerHTML = s.endHtml(s.passed, total);
    if (pos) pos.textContent = total ? `${total} of ${total}` : "";
    return;
  }
  if (pos) pos.textContent = `${s.idx + 1} of ${total}`;
  const behind = s.idx + 1 < total ? `<div class="stk-behind" aria-hidden="true">${s.cardHtml(s.items[s.idx + 1], s.idx + 1)}</div>` : "";
  wrap.innerHTML = behind + `<div class="stk-card">${s.cardHtml(s.items[s.idx], s.idx)}</div>`
    + `<div class="stk-actions"><button type="button" class="stk-pass" aria-label="Pass" onclick="stackButton('${key}','pass')">&#10005;</button><button type="button" class="stk-go" onclick="stackButton('${key}','go')">${esc(s.goLabelFor ? s.goLabelFor(s.items[s.idx]) : s.goLabel)}</button></div>`;
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
    summary: "Every SIGNL comped visit includes: 1 post or reel + 1 story that shares the post, within 48 hours of the visit, honest and disclosed, live at least 30 days, with tracked delivery proof. Paid bookings carry the deliverables set in the booking's own terms. Content rights follow the visit, never the plan: on a comp visit the business may share the post natively only, with the creator tagged; no downloads, no reposting the file, no ad use. On a paid visit the business may also repost the post and run it as an ad for 6 months from the post date. The creator always owns their content, and nobody can edit it.",
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
    <div class="drow"><span class="dk">Paid adds</span><span class="dv">Repost + ad use for 6 months</span></div>
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
  terms.push(["Rights", o.kind === "paid" ? "Share + repost + ads 6 months &middot; no edits" : "Native share only &middot; no edits, downloads or ads"]);
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
      can: ["Share your post natively, with you tagged", "Repost it on their own feed", "Run it as an ad for 6 months from the post date (never longer)"],
      cannot: ["Edit your post", "Use it in ads after the 6-month window"],
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
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}

// App-style bottom navigation (Jeff, 2026-10-18; unified in the
// UX redesign, 2026-10-24): ONE nav system per role at every width.
// Signed-in views render the bar at all widths (centered, max
// width on desktop); signed-out views keep the mobile-only bar.
// Tab badges ride the counts GET /notifications returns.
function renderBottomNav() {
  if (!bottomnav) return;
  const signedIn = !!state.user && state.view !== "staff";
  bottomnav.classList.toggle("signed-in", signedIn);
  document.body.classList.toggle("bn-on", signedIn);
  if (state.view === "staff") { bottomnav.innerHTML = ""; return; }
  const badgeBubble = (n) => (n ? `<span class="bn-badge">${n > 99 ? "99+" : n}</span>` : "");
  const item = (icon, label, onclick, active, badge) => `
    <button class="bn-item ${active ? "on" : ""}" onclick="${onclick}">
      <span class="bn-icon">${bnIcon(icon)}${badgeBubble(badge)}</span><span class="bn-label">${label}</span>
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
  if (u.status !== "approved" || u.role === "admin" || isFoundingBusiness(u)) {
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
  const b = state.badges || {};
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
      item("offers", "Offers", "return go('dashboard','Offers')", t === "Offers", b.offers) +
      item("visits", "My Visits", "return go('dashboard','My Visits')", t === "My Visits", b.visits) +
      item("messages", "Messages", "return go('dashboard','Messages')", t === "Messages", b.messages) +
      item("signout", "Sign out", "signOut()", false);
    return;
  }
  // business: Home, Discover, Offers, Counter, More. The rest of
  // the sections (Favorites, Visits & Posts, Plan, Messages) live
  // in the More sheet, so the bar stays at five targets.
  const moreActive = ["Favorites", "Visits & Posts", "Plan", "Messages"].includes(t);
  bottomnav.innerHTML =
    item("home", "Home", "return go('dashboard','Home')", t === "Home" || !t, b.visits) +
    item("pin", "Discover", "return go('dashboard','Discover')", t === "Discover") +
    item("offers", "Offers", "return go('dashboard','My Offers')", t === "My Offers", b.offers) +
    item("visits", "Counter", "return go('dashboard','Counter')", t === "Counter") +
    item("list", "More", "return openMoreSheet()", moreActive, b.messages);
}

// Tab badges (UX redesign section 2): GET /notifications carries
// { offers, visits, messages, total } counted over unread
// notifications. Stored on state and the bar re-renders in place.
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
    <p class="small muted mt">Open now in all 39 markets &middot; Decisions within 2 business days</p>
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
      <div class="rule-row">No post in 48 hours? Replacement visit.</div>
      <details class="deal-details"><summary>All the rules</summary><div class="dd-body"><p class="small">A business can never require a positive post, a rating, or specific words. Creators disclose every comp, as the FTC requires. If a post does not land in 48 hours, the business gets a replacement visit. Invite other creators and earn Momentum points (+3 per sign-up through your link, +10 per approval). Points order the creator list businesses see.</p></div></details>
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
        <div class="field"><label id="qc-handle-label">Your ${esc(primaryLabelClient(pfPlatform))} handle (required)</label><input id="qc-handle" placeholder="yourhandle" required value="${esc(pf.handle || "")}" oninput="syncQcPlatform()"><p class="small muted" id="qc-ig-link">${pf.handle ? esc(primaryMetaClient(pfPlatform).host + pf.handle) : ""}</p></div>
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
      handle: document.getElementById("qc-handle").value,
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
        <div class="field"><label id="jc-handle-label">${esc(primaryLabelClient(pf.platform || "instagram"))} handle (required)</label><input id="jc-handle" placeholder="yourhandle" required value="${esc(pf.handle || "")}" oninput="syncJcPlatform()"><p class="small muted" id="jc-ig-link"></p></div>
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
      <button class="btn" type="submit" style="width:100%">Create my founding profile</button>
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
      handle: document.getElementById("jc-handle").value,
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
      <strong>${esc(p.name)}</strong>
      <p class="small muted">${p.minMonths}-month minimum.</p>
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
      <button class="btn mt" type="submit" style="width:100%">Join the founding business list</button>
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
  app.innerHTML = `
  <section class="panel" style="max-width:640px;margin:24px auto">
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
  <div style="max-width:640px;margin:0 auto">${accountHtml(u)}</div>`;
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
    <p class="small muted">No card is charged in the app yet. This records the booking and holds the amount in the app ledger. It is released after the post is live and the 48 hour hold passes.</p>
    <div class="field"><label>Key points for the creator (optional)</label><textarea id="paid-brief" rows="3" maxlength="500" placeholder="What to feature, names, dates"></textarea><p class="small muted">${PAID_BRIEF_GUIDANCE}</p></div>
    <button class="btn" style="width:100%" id="paid-sheet-book">Book paid visit</button>
    <button class="btn ghost" style="width:100%;margin-top:8px" id="paid-sheet-cancel">Cancel</button>
  </div>`;
  document.body.appendChild(el);
  document.getElementById("paid-sheet-cancel").onclick = () => closePaidSheet();
  el.addEventListener("click", (e) => { if (e.target === el) closePaidSheet(); });
  document.getElementById("paid-sheet-book").onclick = async () => {
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
    alert(`PREVIEW paid booking (simulation)\n\nCreator rate: $${fmtPrice(bk.rate)}\nYou pay: $${fmtMoney(bk.businessTotal)} (rate + 3%)\nCreator keeps: $${fmtMoney(bk.creatorNet)} (97% of their rate)\nSIGNL fee: $${fmtMoney(bk.platformFee)} total, split evenly\nEscrow: held by SIGNL until the post is live\n\n${bk.paymentNote}\n${bk.note}`);
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
      <div class="cc-photo${c.photoUrl ? "" : " no-photo"}">
        ${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="">` : `<div class="cc-mono"><span>${initial}</span></div>`}
        ${p.tierBand ? `<span class="cc-tier">${esc(p.tierBand)}</span>` : ""}
        ${p.paidRate ? `<span class="cc-paid">Paid bookings: $${fmtPrice(p.paidRate)}</span>` : ""}
      </div>
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
    <div class="cta-row" style="justify-content:flex-start">
      ${preview
        ? `<button class="btn" onclick="previewStartOffer('${c.userId}')">Send this creator an offer (preview)</button>${p.paidRate ? ` <button class="btn ghost" onclick="previewPaidBooking('${c.userId}')">Preview paid booking ($${fmtPrice(p.paidRate)})</button>` : ""}`
        : `<button class="btn" onclick="startOffer('${c.userId}')">Send offer</button>${p.paidRate ? ` <button class="btn" onclick="bookPaidVisit('${c.userId}')">Book paid visit ($${fmtPrice(p.paidRate)})</button>` : ""} <button class="btn ghost" onclick="openThread('${c.userId}')">Message</button>`}
    </div>
    ${p.paidRate ? `<p class="small muted">Paid bookings: $${fmtPrice(p.paidRate)} &middot; you pay rate + 3% &middot; they keep 97% &middot; held until the post is live.</p>` : ""}
    ${preview ? `<p class="small muted">Preview: an offer sent from here is a simulation. It never reaches ${esc(c.name)} and nothing is saved.</p>` : ""}
    ${preview && c.trackRecord && c.trackRecord.postsDelivered > 0 ? `
    <div class="showcase-block"><h4>Ad use (preview)</h4>
      <p class="small muted">Ad use comes with paid visits: on a paid visit, a business can repost the post and run it as an ad for 6 months from the post date. In the real app that logs the use, notifies the creator, and awards +25 Momentum. Here it is a simulation: nothing is logged and no points move.</p>
      <button class="btn small-btn ghost" onclick="previewAdUse('${c.userId}')">Use a delivered post in an ad (preview)</button> <span id="pv-aduse-note" class="saved"></span>
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
      ${p.paidRate ? `<span class="cc-paid">Paid bookings: $${fmtPrice(p.paidRate)}</span>` : ""}
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
    <p class="small muted">Every SIGNL comped visit: 1 post or reel + 1 story that shares the post within 48 hours, tracked as proof. Paid bookings carry the deliverables set in the booking's terms. Content rights follow the visit: comp visits are native share only; paid visits add repost and 6-month ad rights.</p>
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
  if (tab === "Dashboard") body = `<div id="creator-home" class="vx-stagger">${skelHtml("Loading your dashboard...", 2)}</div>`;
  if (tab === "Profile") body = creatorProfileHtml(u) + momentumHtml(u) + growRosterHtml(u);
  app.innerHTML = `
    <h2>Creator dashboard <span class="badge ok">Founding Creator</span></h2>
    ${standingBannerHtml(u)}
    <div id="tab-body">${body}</div>`;
  if (tab === "Dashboard") loadCreatorHome();
  if (tab === "Profile") { setTimeout(loadMyScore, 10); setTimeout(() => { setupUniversityAutocomplete("p-university", "p-university-results"); dragInit(); }, 10); }
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
  const placeBadge = u.market === unlistedLabel() ? esc(u.city || u.market) : esc(marketDisplayName(u.market));
  let body = "";
  if (tab === "Dashboard") body = `<div id="founding-dash" class="vx-stagger">${skelHtml("Loading your dashboard...", 2)}</div>`;
  if (tab === "Status") body = `<h3 style="margin-top:0">Your founding status</h3><div id="founding-body">${skelHtml("Loading your founding profile...", 1)}</div>`;
  if (tab === "Profile") body = creatorProfileHtml(u);
  app.innerHTML = `
    <h2>Creator dashboard <span class="badge ok">Founding Creator</span></h2>
    ${standingBannerHtml(u)}
    <div id="tab-body">${body}</div>`;
  if (tab === "Dashboard") loadFoundingDashboard();
  if (tab === "Status") loadFoundingStatus();
  if (tab === "Profile") { setTimeout(loadMyScore, 10); setTimeout(() => { setupUniversityAutocomplete("p-university", "p-university-results"); dragInit(); }, 10); }
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
    el.innerHTML = `
    <div class="dash-hero">
      <p class="dh-kicker">Creator dashboard &middot; ${place}</p>
      <div class="dh-name">${esc(greet)}, ${esc(firstName)}.</div>
      <p class="dh-sub">${isUnl ? `${esc(f.city)} opens when sign-ups pile up. Your numbers, paid lane and roster.` : `${esc(marketTalkNameClient(f.market))} opens in the next ${esc(f.launchWindow)}. Your numbers, paid lane and roster.`}</p>
      <div class="dh-row"><div><div class="dh-num">${fmtNum(totalAudienceOf(card))}</div><div class="dh-num-lbl">Total audience across your platforms</div></div></div>
    </div>
    ${profileCompletionHtml(u)}
    <div class="panel">
      <div class="flex-between">
        <div>
          <h3 style="margin:0">${esc(u.name)} <span class="muted">@${esc(p.handle || "")}</span></h3>
          <p class="muted small">${isUnl ? place : `${esc(marketDisplayName(f.market))} &middot; ${esc(f.city)}`}</p>
        </div>
        <span class="badge ok" style="font-size:0.95rem;padding:6px 14px">Founding Creator</span>
      </div>
      <p class="small">${p.localAudiencePct === null || p.localAudiencePct === undefined ? `Add your local audience % in your profile` : `${p.localAudiencePct}% local audience`} &middot; ${esc(p.tierBand || "")} tier &middot; ${fmtNum(totalAudienceOf(card))} total audience${f.priorityBand ? ` &middot; first ${f.priorityBand} founding` : ""}${campusBadgeHtml(card)}</p>
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
    <div class="home-count home-tick" data-mode="post" data-target="${esc(b.postDeadline || "")}">${esc(homeDurCore(diff))}${diff < 0 ? " overdue" : ""}</div>
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
    <p class="small muted">Best fits land here first.</p>
  </section>`;
  }
  const cards = ranked.slice(0, 3).map((o) => {
    const rights = o.visitRights || rightsForVisit(o.kind);
    const left = Math.max(0, (o.spots || 0) - (o.bookedCount || 0));
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
          <form onsubmit="return homeAcceptOffer(event, '${o.id}')">
            <button class="btn small-btn book" type="submit">Accept</button>
          </form>
        </div>
      </div>
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
function laneControlsHtml(c) {
  const compOn = !c || c.compOpen !== false;
  const rate = laneRateOf(c || {});
  return `<div class="lane-ctl" id="lane-controls">
    ${compOn && rate ? "" : `<div class="lane-bothrow"><button type="button" class="btn small-btn" onclick="return laneBothOn()">Turn both on</button></div>`}
    <div class="lrow lane-row"><input type="checkbox" class="sw lane-sw" id="lane-comp" ${compOn ? "checked" : ""} onchange="laneToggleComp(this)"><div><label class="lname" for="lane-comp">Comp visits</label> <span class="lline" id="lane-comp-line">— ${esc(laneCompLine(c || {}))}</span></div></div>
    <div class="lrow lane-row"><input type="checkbox" class="sw lane-sw" id="lane-paid" ${rate ? "checked" : ""} onchange="laneTogglePaid(this)"><div><label class="lname" for="lane-paid">Paid bookings</label> <span class="lline" id="lane-paid-line">— ${esc(lanePaidLine(c || {}))}</span></div></div>
    <div class="lane-rate" id="lane-rate-row" style="display:${rate ? "block" : "none"}">
      <label for="lane-rate">Your paid rate (min $50)</label>
      <div class="lane-rate-flex"><input type="number" id="lane-rate" min="50" step="1" inputmode="numeric" placeholder="150" value="${rate || ""}" onchange="laneRateAuto()"><button type="button" class="btn small-btn" onclick="return laneRateSave()">Save rate</button></div>
      <p class="small muted" id="lane-rate-note">${rate ? `At $${fmtMoney(rate)} you keep $${fmtMoney(Math.round(rate * 0.97 * 100) / 100)} (97%).` : "Paid bookings turn on when a rate is saved."}</p>
    </div>
    <p class="small lane-err" id="lane-err" style="display:none"></p>
  </div>`;
}
function laneErr(msg) {
  const e = document.getElementById("lane-err");
  if (e) { e.textContent = msg || ""; e.style.display = msg ? "block" : "none"; }
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
    <p class="small muted">Recorded in the app, no card charged. Held until your post is live — released 48h after proof.</p>
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
    <div class="dash-hero">
      <p class="dh-kicker">Creator dashboard &middot; ${esc(marketDisplayName(u.market))}</p>
      <div class="dh-name">${esc(greet)}, ${esc(firstName)}.</div>
      <p class="dh-sub">Your visit, offers and money.</p>
      <div class="dh-row"><div><div class="dh-num">${m.points}</div><div class="dh-num-lbl">Momentum points</div></div></div>
    </div>
    ${profileCompletionHtml(u)}
    <div class="stat-band home-metrics">
      <div class="stat-cell"><div class="stat-num">$${fmtMoney(money.released)}</div><div class="stat-lbl">${money.released ? "Paid cash released" : "Your first paid visit puts money here."}</div></div>
      <div class="stat-cell"><div class="stat-num">$${fmtMoney(money.compValue)}</div><div class="stat-lbl">${money.compValue ? "Comp value received" : "Your first comped visit lands here."}</div></div>
      <div class="stat-cell"><div class="stat-num">${tr.onTimePct === null || tr.onTimePct === undefined ? "New" : tr.onTimePct + "%"}</div><div class="stat-lbl">On-time posts (${tr.postsDelivered || 0} delivered)</div></div>
      <div class="stat-cell"><div class="stat-num"><em>${m.points}</em></div><div class="stat-lbl">Momentum points</div></div>
    </div>
    ${card.ratingCount >= 1 && card.ratingAvg !== null && card.ratingAvg !== undefined
      ? `<p class="small">${starsHtml(card.ratingAvg)} <strong>Your rating: ${esc(String(card.ratingAvg))}</strong> from ${card.ratingCount} business${card.ratingCount === 1 ? "" : "es"}, shown next to your Momentum points.</p>`
      : `<p class="small muted">Your rating appears after your first rated visit.</p>`}
    ${strikeStatusHtml(u)}
    ${homeActiveVisitHtml(homeActiveBooking(bookings))}
    ${bookings.filter((b) => b.post && perfUpdateDue(b.post)).map((b) => perfUpdateFormHtml(b, "home")).join("")}
    ${homeOpportunitiesHtml(offers, u)}
    ${homeLocalSignalHtml(card, bookings)}
    ${homePaidLaneHtml(u.creator)}
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
      <div class="field"><label>Profile photo</label>
        ${c.hasPhoto ? `<img class="profile-photo" src="/api/users/${esc(u.id)}/photo" alt="Your profile photo">` : `<div class="photo-placeholder">No photo yet.</div>`}
        <input type="file" id="p-photo" accept="image/png,image/jpeg,image/webp">
        <p class="small muted">Pick a new photo and save to replace it. PNG, JPEG, or WebP, under 2.5 MB.</p>
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
    const uploaded = await uploadPhotoInput("p-photo");
    // Un-completion guard (audit F9): name the consequence BEFORE
    // the save lands and take an explicit confirm. A photo the
    // creator picked that failed to upload is named too, instead
    // of failing in silence (audit F11). After the confirm, the
    // save proceeds unchanged.
    const photoInput = document.getElementById("p-photo");
    const photoFailed = !!(photoInput && photoInput.files && photoInput.files[0]) && !uploaded;
    const warnings = uncompleteWarnings(wasProfileComplete, { localPctBlank: pctRaw === "", categoryCount: cats.length, stackTotal: profileStackTotal() });
    if (photoFailed) warnings.push("Your new photo did not upload, so your profile keeps the photo it has now. You can try the photo again after saving.");
    if (warnings.length) {
      const proceed = await confirmSaveWarning("save-warn", "Before you save:", warnings, "Save anyway");
      if (!proceed) { submitBusy(form, false); return false; }
    }
    const cityEl = document.getElementById("p-city");
    const cityTextEl = document.getElementById("p-city-text");
    const data = await api("PATCH", "/me/profile", {
      name: document.getElementById("p-name").value,
      handle: document.getElementById("p-handle").value,
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
      tiktokHandle: document.getElementById("p-tiktok").value,
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
    if (uploaded && state.user.creator) state.user.creator.hasPhoto = true;
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

async function loadCreatorOffers() {
  const el = document.getElementById("tab-body");
  el.innerHTML = `
    <div id="open-board">${skelHtml("Loading open offers in " + marketTalkNameClient(state.user.market) + "...", 2)}</div>
    <div id="my-apps"></div>
    <h3>Sent directly to you</h3>
    <div id="direct-offers">${skelHtml("Loading your direct offers...", 1)}</div>
    <div id="creator-notes" class="mt"></div>`;
  loadOpenBoard();
  loadMyApplications();
  loadNotificationsInto("creator-notes");
  const direct = document.getElementById("direct-offers");
  try {
    const data = await api("GET", "/offers");
    const mine = (data.offers || []).filter((o) => o.lane !== "open");
    if (!mine.length) {
      direct.innerHTML = `<div class="empty-state"><span class="es-badge"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg></span><h3>No direct offers yet</h3><p>Offers sent to you land here.</p></div>`;
      return;
    }
    direct.innerHTML = `<div class="vx-stagger">` + mine.map((o) => { const rights = o.visitRights || rightsForVisit(o.kind); return `
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
            <form onsubmit="return acceptOffer(event, '${o.id}')">
              <button class="btn book" type="submit">Accept</button>
            </form>
            ${o.creatorId ? `<button class="btn small-btn danger" onclick="declineOffer('${o.id}')">Decline</button>` : ""}
            <button class="btn small-btn ghost" onclick="openThread('${o.businessId}')">Message</button>
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
      el.innerHTML = `<div class="empty-state"><span class="es-badge"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg></span><h3>Open offers in ${esc(marketTalkNameClient(state.user.market))}</h3><p>No open offers right now. New offers land here first.</p></div>`;
      return;
    }
    state.openOffers = data.offers;
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
// mode — same rows, same buttons, same handlers.
function offerFeedCardHtml(o) {
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
              ? `<span><span class="badge info">Applied</span> <a href="#" onclick="document.getElementById('my-apps').scrollIntoView({behavior:'smooth'}); return false;">My Applications</a></span>`
              : `<button class="btn book" onclick="applyToOffer('${o.id}')">Apply</button>`}
            <button class="btn small-btn ghost" onclick="openThread('${o.businessId}')">Message</button>
          </div>
        </div>
      </div>`;
}

// ---------- V5: the Offers feed as a card stack (Jeff, 2026-10-25) ----------
// Same stack model as Discover. Apply runs the exact apply call
// (one tap, no added confirm — identical to the list button);
// Pass hides the offer for this session only: there is NO
// dismissal mechanism anywhere in the codebase for open offers
// (decline exists only for direct offers), so passes live in
// stackState and the end card offers "Show passed" to reset.
function offersModeToggleHtml() {
  const mode = state.offersMode || "cards";
  return `<div class="view-toggle"><div class="vt-group"><button type="button" class="rchip${mode === "cards" ? " on" : ""}" onclick="setOffersMode('cards')">Cards</button><button type="button" class="rchip${mode === "list" ? " on" : ""}" onclick="setOffersMode('list')">List</button></div><span class="stack-pos" data-stackpos="offers"></span></div>`;
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
    el.innerHTML = `<div class="vx-stagger">${all.map((o) => offerFeedCardHtml(o)).join("")}</div>`;
    return;
  }
  if (!stackState.offers || stackState.offers.src !== all) {
    stackState.offers = {
      items: all, idx: 0, passed: 0, passedIds: new Set(), src: all,
      cardHtml: (o) => offerFeedCardHtml(o),
      goLabelFor: (o) => (o.myApplication ? "Applied" : "Apply"),
      onGo: async (o) => {
        if (o.myApplication) { stackAdvance("offers", "go"); return; }
        try {
          await api("POST", `/offers/${o.id}/apply`, {});
          o.myApplication = true;
          refreshBadges();
          stackAdvance("offers", "go");
          loadMyApplications();
        } catch (err) {
          alert(err.message);
          const wrap = document.querySelector('[data-stack="offers"]');
          if (wrap) renderStack(wrap);
        }
      },
      onPass: (o) => { if (stackState.offers) stackState.offers.passedIds.add(o.id); },
      onTap: null,
      endHtml: (passed, total) => offersEndHtml(passed, total),
    };
  }
  el.innerHTML = `<div class="stk-wrap" data-stack="offers"></div>`;
  renderStack(el.firstElementChild);
}
function offersEndHtml(passed, total) {
  return `<div class="stk-end"><h3>That's every open offer right now</h3><p class="small muted">You looked through ${total} offer${total === 1 ? "" : "s"}. New offers land here first, and your applications are tracked under My Applications below.</p><div class="stk-end-actions">${passed ? `<button type="button" class="btn ghost" onclick="offersShowPassed()">Show passed (${passed})</button>` : ""}<button type="button" class="btn" onclick="loadOpenBoard()">Refresh offers</button></div></div>`;
}
function offersShowPassed() {
  const s = stackState.offers;
  if (s) { s.idx = 0; s.passed = 0; s.passedIds = new Set(); }
  renderOpenBoard();
  return false;
}

async function applyToOffer(offerId) {
  try {
    await api("POST", `/offers/${offerId}/apply`, {});
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

async function loadMyVisits(role) {
  const el = document.getElementById("tab-body");
  try {
    const data = await api("GET", "/bookings");
    const flash = state.postFlash
      ? `<div class="card mb"><div class="success-hero">${successCheckHtml()}<h3>Post submitted</h3><p>Your post is in and the visit is marked delivered. Your numbers build from here: update them as the post grows and they feed your track record.</p></div></div>`
      : "";
    state.postFlash = false;
    if (!data.bookings.length) {
      el.innerHTML = flash + `<div class="empty-state"><span class="es-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg></span><h3>No visits yet</h3><p>${role === "creator" ? "Accept an offer and your visit, code, and post deadline will live here." : "Bookings from your offers will live here."}</p>${role === "creator" ? `<button class="btn" onclick="return go('dashboard','Offers')">Browse open offers</button>` : `<button class="btn" onclick="return go('dashboard','My Offers')">Create an offer</button>`}</div>`;
      return;
    }
    el.innerHTML = flash + `<div class="vx-stagger">${data.bookings.map((b) => visitCard(b, role)).join("")}</div>`;
    if (role === "creator") startHomeCountdown();
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
    case "overdue": return `<span class="badge bad">Post overdue</span>`;
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
  <div class="card visit-card mb">
    <div class="flex-between"><strong>${esc(b.title)}</strong>${complianceBadge(b)}</div>
    <p class="small muted">${role === "creator" ? esc(b.businessName) : "@" + esc(b.creatorHandle) + " (" + esc(b.creatorName) + ")"} &middot; ${esc(marketDisplayName(b.market))} &middot; Comp: ${esc(b.whatComped)} (cap $${fmtMoney(b.dollarCap)})${b.kind === "paid" || b.paidLane ? "" : ` &middot; ${coversLine(b)}`} &middot; Visit: ${esc(b.visitDate || b.visitWindow || "Flexible")}</p>`;
  if (role === "creator" && b.redeemedAt && !post && b.postDeadline) {
    // Visual pass: the post countdown leads the card instead of
    // sitting under the honor form below the fold. Same ticking
    // element (home-tick), moved up; the proof form below keeps
    // its own deadline copy.
    const dueLate = b.compliance && (b.compliance.status === "overdue" || b.compliance.status === "paused" || b.compliance.status === "missed");
    html += `
    <div class="due-banner${dueLate ? " late" : ""}"><span class="db-lbl">${dueLate ? "Post overdue" : "Post due in"}</span><span class="db-num home-tick" data-mode="post" data-target="${esc(b.postDeadline)}">${esc(homeDurCore(Date.parse(b.postDeadline) - Date.now()))}</span></div>`;
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
      ? `<p class="small"><span class="badge tier">Paid visit</span> Your rate $${fmtPrice(lane.rate)}: you receive $${fmtMoney(lane.creatorNet)} (97% of your rate). ${escrowBadge}<br><span class="muted">${esc(lane.paymentNote)}${lane.escrowState === "held" && lane.proofAt ? " Your post is in; the escrow releases 48 hours after proof." : ""}${lane.escrowState === "refunded" ? " This visit resolved without delivery, so the business was refunded." : ""}</span></p>`
      : `<p class="small"><span class="badge tier">Paid visit</span> Creator rate $${fmtPrice(lane.rate)} &middot; you pay $${fmtMoney(lane.businessTotal)} (rate + 3%) &middot; the creator receives $${fmtMoney(lane.creatorNet)}. ${escrowBadge}<br><span class="muted">${esc(lane.paymentNote)}</span></p>`;
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
    if (post.adUseDeclaredAt) {
      html += `<p class="small"><span class="badge ok">Running as an ad</span> Declared ${fmtDate(post.adUseDeclaredAt)}. The creator was notified and earned +25 Momentum.${role === "business" && post.adUseWindowEndsAt ? ` This paid visit's ad window runs to ${fmtDate(post.adUseWindowEndsAt)}.` : ""}</p>`;
    } else if (role === "business") {
      if (b.kind === "paid") {
        html += `<button class="btn small-btn ghost" onclick="declareAdUse('${post.id}')">Use in an ad</button> <span class="small muted">This was a paid visit: ad use is included for 6 months from the post date. The creator is notified and earns +25 Momentum.</span>`;
      } else {
        html += `<p class="small muted">This was a comp visit, so it covers native sharing only, with the creator tagged. Ad use comes with paid visits.</p>`;
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
      <button class="btn small-btn" type="submit">Report numbers (+5 Momentum)</button>
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
  if (role === "business" && b.postState === "overdue" && !b.replacementRequestedAt) {
    html += `<button class="btn small-btn danger" onclick="requestReplacement('${b.id}')">Request replacement visit</button>`;
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
      <button class="btn small-btn" type="submit">Leave review (+10 Momentum)</button>
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

async function declareAdUse(postId) {
  if (!confirm("Use this post in an ad? This paid visit includes ad use for 6 months from the post date. The creator is notified and earns +25 Momentum.")) return;
  try { await api("POST", `/posts/${postId}/ad-use`, {}); loadMyVisits("business"); }
  catch (err) { alert(err.message); }
}

// ---------- business ----------

const BUSINESS_TABS = ["Home", "Discover", "Favorites", "My Offers", "Counter", "Visits & Posts", "Plan", "Messages"];

function renderBusinessDash() {
  const u = state.user;
  let tab = state.tab || "Home";
  if (!BUSINESS_TABS.includes(tab)) tab = "Home";
  // A "Send offer" from Discover lands on the composer, as before.
  if (state.offerTarget) tab = "My Offers";
  state.tab = tab;
  app.innerHTML = `
    <h2>${esc(u.business.businessName)}</h2>
    <p class="muted small" style="margin-top:-8px">${esc(u.market)} &middot; ${esc(u.business.planName)}</p>
    <div id="tab-body"></div>`;
  if (tab === "Home") loadBusinessHome();
  if (tab === "Discover") loadDiscover();
  if (tab === "Favorites") loadFavorites();
  if (tab === "My Offers") loadMyOffers();
  if (tab === "Counter") renderCounter();
  if (tab === "Visits & Posts") loadMyVisits("business");
  if (tab === "Plan") renderPlanTab();
  if (tab === "Messages") loadThreads();
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

async function loadBusinessHome() {
  const el = document.getElementById("tab-body");
  try {
    const d = await api("GET", "/me/business-home");
    const h = d.home;
    const stages = [
      [h.pipeline.invited, "Invited", "Bookings created"],
      [h.pipeline.claimed, "Claimed", "Codes issued"],
      [h.pipeline.visitSet, "Visit set", "Windows open"],
      [h.pipeline.clockRunning, "48h clock", "Visits redeemed"],
      [h.pipeline.live, "Live", "Posts delivered"],
    ];
    const attention = h.attention && h.attention.length ? `
      <div class="notice" style="margin-top:16px"><strong>${h.attention.length} item${h.attention.length === 1 ? "" : "s"} need${h.attention.length === 1 ? "s" : ""} your attention.</strong>
      ${h.attention.map((a) => `<br><strong>${esc(a.label)}:</strong> ${esc(a.detail)}${a.kind === "offer_nudge" ? ` <button class="btn small-btn" onclick="fixOffer('${esc(a.offerId)}','raise')">Raise comp +$25</button> <button class="btn small-btn ghost" onclick="fixOffer('${esc(a.offerId)}','widen')">Widen window +3 days</button>` : ""}${a.kind === "applications" ? ` <button class="btn small-btn" onclick="return goApplicants('${esc(a.offerId)}')">Review the stack</button>` : ""}`).join("")}</div>`
      : `<div class="notice blue" style="margin-top:16px"><strong>Nothing needs your attention.</strong> Every visit is on track.</div>`;
    const content = (h.topContent || []).map((c) => `
      <div class="ui-row"><span class="k"><strong>${esc(c.title)}</strong> with @${esc(c.creatorHandle)}<br><span class="small muted">${fmtNum(c.views)} views &middot; ${fmtNum(c.likes)} likes &middot; ${c.onTime ? "posted on time" : "posted late"}${c.roasScore !== null && c.roasScore !== undefined ? ` &middot; SIGNL ROAS ${c.roasScore.toFixed(2)}&times;` : ""}${c.performanceUpdatedAt ? `<br>${perfSourceLabel(c.performanceSource)}, updated ${fmtDay(c.performanceUpdatedAt)}` : ""}</span></span><span class="v">${c.redemptions ? `${c.redemptions.count} code uses<br>$${fmtMoney(c.redemptions.basketTotal)} rung up` : "No tally yet"}</span></div>`).join("");
    const next = (h.nextVisits || []).map((n) => `
      <div class="ui-row"><span class="k"><strong>${esc(n.title)}</strong> with @${esc(n.creatorHandle)}<br><span class="small muted">${esc(n.stateLabel)}${n.dueInLabel ? ` &middot; ${esc(n.dueInLabel)}` : ""}</span></span><span class="v">${esc(n.whenLabel)}<br>${esc(fmtDate(n.when))}</span></div>`).join("");
    const rebook = (d.rebookPrompts || []).map((r) => `
      <div class="ui-row"><span class="k"><strong>${esc(r.name)}</strong> @${esc(r.handle)}${r.isFavorite ? ` <span class="badge tier">Favorite</span>` : ""}<br><span class="small muted">${r.source === "delivered" ? `Delivered for you before: ${esc(r.lastTitle || "")}` : "Saved in your favorites"}</span></span><span class="v"><button class="btn small-btn" onclick="rebookCreator('${esc(r.creatorId)}')">Invite again</button></span></div>`).join("");
    el.classList.add("vx-stagger");
    const heroNum = h.roasScore !== null && h.roasScore !== undefined && Number(h.roasScore) !== 0
      ? { num: Number(h.roasScore).toFixed(2) + "&times;", lbl: "SIGNL ROAS Score" }
      : { num: `${h.visitsUsed} of ${h.visitsAllowance}`, lbl: "Creator visits booked this month" };
    el.innerHTML = `
    <div class="dash-hero">
      <p class="dh-kicker">${esc(marketDisplayName(d.business.market))} &middot; ${esc(d.plan.name)} plan</p>
      <div class="dh-name">${esc((state.user.business && state.user.business.businessName) || d.business.businessName || "")}</div>
      <p class="dh-sub">Your visits, posts and results.</p>
      <div class="dh-row"><div><div class="dh-num">${heroNum.num}</div><div class="dh-num-lbl">${heroNum.lbl}</div></div></div>
    </div>
    ${d.marketLive ? "" : `<div class="notice blue"><strong>Your market opens in 30–90 days.</strong> Draft offers now — publishing switches on at launch.</div>`}
    <div class="panel" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <div><strong>At the register?</strong><p class="muted small" style="margin:4px 0 0">Staff redeem with the PIN + creator code. No login needed.</p></div>
      <button class="btn" onclick="return goStaff()">Redeem a creator visit</button>
    </div>
    ${d.staffPinSet === false ? `<div class="notice"><strong>Set your staff PIN.</strong> Your team redeems visits with it — never your login. <button class="btn small-btn" onclick="return go('dashboard','Plan')">Set the staff PIN</button></div>` : ""}
    <section class="panel">
      <h3 style="margin-top:0">Business home</h3>
      <div class="stat-band home-metrics">
        <div class="stat-cell"><div class="stat-num">${h.visitsUsed}<span class="small muted"> of ${h.visitsAllowance}</span></div><div class="stat-lbl">Visits booked this month &middot; ${h.visitsRemaining} left</div></div>
        <div class="stat-cell"><div class="stat-num">${h.postsLive}</div><div class="stat-lbl">Posts live</div></div>
        ${roasCellHtml(h, true)}
        <div class="stat-cell"><div class="stat-num">${h.onTimeRatePct === null ? "n/a" : h.onTimeRatePct + "%"}</div><div class="stat-lbl">Posts on time</div></div>
      </div>
      ${attention}
      <h4>Visit pipeline</h4>
      <div class="pv-funnel">${stages.map(([n, label, sub]) => `<div class="pv-stage"><div class="pv-stage-num">${n}</div><div class="pv-stage-lbl">${label}</div><div class="pv-stage-sub">${sub}</div></div>`).join("")}</div>
      <h4>Plan pace</h4>
      <div class="flex-between"><span class="small"><strong>${esc(d.plan.name)} plan:</strong> ${h.visitsUsed} of ${h.visitsAllowance} visits booked this month</span><span class="badge ${h.planPacePct >= 100 ? "warn" : "info"}">${h.planPacePct}%</span></div>
      <div class="meter" style="margin-top:8px"><i style="width:${Math.min(100, h.planPacePct)}%"></i></div>
      <p class="small muted">${esc(d.business.billingStatus)}</p>
      ${content ? `<div class="tint-block"><h4>Content that is working</h4>
${content}</div>` : ""}
      ${next ? `<h4>Next visits</h4>${next}` : ""}
      ${rebook ? `<div class="tint-block"><h4>Invite again</h4><p class="small muted">Your delivered creators + favorites.</p>${rebook}</div>` : ""}
    </section>
    <div id="biz-notes" class="mt"></div>`;
    loadNotificationsInto("biz-notes");
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
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
    if (!data.favorites.length) {
      el.innerHTML = `<div class="panel center"><h3>No favorites yet</h3><p class="muted">Tap the heart on any creator while browsing Discover and they are saved here: your standing roster for repeat visits. Favorites are also first in line in your Invite again prompts.</p><button class="btn mt" onclick="return go('dashboard','Discover')">Browse creators</button></div>`;
      return;
    }
    el.innerHTML = `<p class="muted small">Your saved creators. One tap invites them again, prefilled from your last visit together.</p>
    <div class="creator-grid">${data.favorites.map((c) => `<div>${creatorCard(c, state.user)}<button class="btn small-btn mt" style="width:100%" onclick="rebookCreator('${c.userId}')">Invite again</button></div>`).join("")}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
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
      <div><label>Sort by</label><select id="f-sort"><option value="">Founding order</option><option value="score">Local Impact Score</option><option value="momentum">Momentum (roster standing)</option><option value="fit">Best fit</option></select></div>
      <div><label>&nbsp;</label><label style="font-weight:500"><input type="checkbox" id="f-paid" style="width:auto"> Has a paid rate (paid bookings) only</label></div>
      <div><label>&nbsp;</label><button class="btn small-btn" style="width:100%" onclick="runDiscover()">Search</button></div>
    </div>
    <div id="discover-toggle"></div>
    <div id="discover-results">${skelHtml("Loading creators...", 2)}</div>`;
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
// tap opens the existing profile view, Pass is local to this
// stack session. Cards is the default; List renders the exact
// card grid Discover has always rendered.
function discoverModeToggleHtml() {
  const mode = state.discoverMode || "cards";
  return `<div class="view-toggle"><div class="vt-group"><button type="button" class="rchip${mode === "cards" ? " on" : ""}" onclick="setDiscoverMode('cards')">Cards</button><button type="button" class="rchip${mode === "list" ? " on" : ""}" onclick="setDiscoverMode('list')">List</button></div><span class="stack-pos" data-stackpos="discover"></span></div>`;
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
  if ((state.discoverMode || "cards") === "list") {
    const pos = document.querySelector('[data-stackpos="discover"]');
    if (pos) pos.textContent = "";
    el.innerHTML = `<div class="creator-grid vx-stagger">${all.map((c) => creatorCard(c, state.user)).join("")}</div>`;
    return;
  }
  if (!stackState.discover || stackState.discover.src !== all) {
    stackState.discover = {
      items: all, idx: 0, passed: 0, passedIds: new Set(), src: all,
      cardHtml: (c) => discoverStackCard(c),
      goLabel: "Invite",
      onGo: (c) => { startOffer(c.userId); },
      onPass: (c) => { if (stackState.discover) stackState.discover.passedIds.add(c.userId); },
      onTap: (c) => { openCreatorProfile(c.userId); },
      endHtml: (passed, total) => discoverEndHtml(passed, total),
    };
  }
  el.innerHTML = `<div class="stk-wrap" data-stack="discover"></div>`;
  renderStack(el.firstElementChild);
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
  return `<div class="stk-end"><h3>That's everyone nearby right now</h3><p class="small muted">You looked through ${total} creator${total === 1 ? "" : "s"} in this search. New approved creators land here as they join.</p><div class="stk-end-actions">${passed ? `<button type="button" class="btn ghost" onclick="discoverShowPassed()">Show passed (${passed})</button>` : ""}<button type="button" class="btn" onclick="discoverClearFilters()">Clear filters</button></div></div>`;
}
function discoverShowPassed() {
  const s = stackState.discover;
  if (s) { s.idx = 0; s.passed = 0; s.passedIds = new Set(); }
  renderDiscoverResults();
  return false;
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
  state.tab = "My Offers";
  state.applicantOffer = offerId;
  render();
  return false;
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
    return `<div class="chip-row">${compSuggestions(tierBand).map((s) => `<button type="button" class="chip" onclick="setCompChip('${prefix}', ${JSON.stringify(s.comp)}, ${s.cap})">${esc(s.label)} (~$${fmtPrice(s.cap)})</button>`).join("")}</div>`;
  }
  return `<div class="chip-row"><button type="button" class="chip" onclick="setWindowMode('${prefix}', '7days')">Use within 7 days</button><button type="button" class="chip" onclick="setWindowMode('${prefix}', 'thisweek')">This week (ends Sunday)</button></div>`;
}

function setCompChip(prefix, comp, cap) {
  const c = document.getElementById(prefix + "-comped");
  const k = document.getElementById(prefix + "-cap");
  if (c) c.value = comp;
  if (k) k.value = cap;
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
      <p class="small"><strong>On a comp visit, you can:</strong> ${comp.can.map(esc).join("; ")}. They can't: ${comp.cannot.map(esc).join("; ")}. <strong>On a paid visit, you can also</strong> repost the post on your own feed and run it as an ad for 6 months from the post date. Rights follow the visit, not your plan${planName ? ` (${esc(planName)})` : ""}.</p>
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
  <div class="panel">
    <h3>Create an offer</h3>
    <div id="form-error"></div>
    ${packageSummaryHtml(myPlan, planObj ? planObj.name : null)}
    <div class="field"><label>Who sees this offer ${infoBtn("lane")}</label>
    <div class="chip-row" role="tablist">
      <button type="button" class="chip ${mode === "open" ? "on" : ""}" onclick="setComposerLane('open')">Open offer: creators apply</button>
      <button type="button" class="chip ${mode === "direct" ? "on" : ""}" onclick="setComposerLane('direct')">Direct offer: invite one creator</button>
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
      <div class="field"><label>Exactly what is comped <span class="req-tag">Required</span> ${infoBtn("comped")}</label><input id="o2-comped" value="${dv(dft.comped)}" placeholder="Two entrees and two drinks" oninput="offerCoachUpdate()" onblur="offerValidateField('comped')"><p class="field-err" id="err-o2-comped"></p>${mode === "direct" ? chipsRowHtml("comp", "o2", target && target.profile ? target.profile.tierBand : null) : ""}</div>
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
  <div id="offer-info-pop" class="sheet-overlay" style="display:none" onclick="if(event.target===this) closeOfferInfo()">
    <div class="sheet">
      <div class="flex-between"><strong id="offer-info-title"></strong><button type="button" class="linklike" onclick="closeOfferInfo()">Close</button></div>
      <p class="small" id="offer-info-body"></p>
    </div>
  </div>
  <div id="offer-list">${skelHtml("Loading your offers...", 2)}</div>
  <div id="applicant-stack"></div>`;
  offerCoachUpdate();
  try {
    const data = await api("GET", "/offers");
    const list = document.getElementById("offer-list");
    if (!list) return;
    if (!data.offers.length) { list.innerHTML = `<div class="empty-state"><span class="es-badge"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg></span><h3>No offers yet</h3><p>Your first offer goes out above.</p></div>`; return; }
    list.innerHTML = `<div class="vx-stagger">${data.offers.map((o) => offerCardHtml(o)).join("")}</div>`;
    if (state.applicantOffer) {
      const id = state.applicantOffer;
      state.applicantOffer = null;
      viewApplicants(id);
    }
  } catch (err) {
    const list = document.getElementById("offer-list");
    if (list) list.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
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
  return `
  <div class="card mb feed-card slot-card" id="offer-card-${o.id}">
    <div class="slot-top">
      <div class="slot-body">
        <div class="slot-badges"><span class="badge ${statusBadge}">${esc(o.status)}</span><span class="chip-mini">${o.lane === "direct" ? (o.creatorHandle ? "Direct to @" + esc(o.creatorHandle) : "Direct") : "Open"}</span><span class="chip-mini">${o.filledCount || 0}/${o.spots} spots filled</span>${o.lane === "open" ? `<span class="chip-mini">${o.applicationCount || 0} applications</span>` : ""}</div>
        <div class="slot-name">${esc(o.title)}</div>
        <div class="slot-cat">${esc(o.whatComped)}</div>
        <div class="slot-meta"><span>${when}</span></div>
      </div>
    </div>
    <div class="slot-deal">
    <div class="deal-rows deal-terms">
    <p class="small muted">${terms}${o.kind === "paid" ? "" : ` &middot; ${coversLine(o)}`}</p>
    ${o.kind === "paid" && o.paidBrief ? `<p class="small"><strong>Key points for the creator:</strong> ${esc(o.paidBrief)}</p>` : ""}
    ${o.businessReferralProgram ? `<p class="small"><strong>Referral program active:</strong> creators will see your ${o.businessReferralProgram.url ? "referral link" : "referral code"}${o.businessReferralProgram.note ? " and your note" : ""} on this offer.</p>` : ""}
    ${o.strength ? `<p class="small muted">Offer checklist ${o.strength.score} of ${o.strength.total}: ${firstMissing ? esc(firstMissing.label) : "complete"}</p>` : ""}
    </div>
    </div>
    <div class="slot-foot">
      <div><div class="slot-price">$${fmtPrice(o.kind === "paid" ? o.cashRate : o.dollarCap)}</div><div class="slot-note">${o.kind === "paid" ? "Rate" : "Comp cap"}</div></div>
      <div class="slot-actions">
        ${o.lane === "open" && (o.status === "open" || o.status === "filled") ? `<button class="btn small-btn book" onclick="viewApplicants('${o.id}')">View applicants (${o.applicationCount || 0})</button>` : ""}
        ${o.status === "draft" ? `<button class="btn small-btn book" onclick="publishOffer('${o.id}')">Publish</button>` : ""}
        ${o.nudgeSentAt && o.status === "open" && !(o.applicationCount > 0) ? `<button class="btn small-btn" onclick="fixOffer('${o.id}','raise')">Raise comp +$25</button><button class="btn small-btn ghost" onclick="fixOffer('${o.id}','widen')">Widen window +3 days</button>` : ""}
        ${(o.status === "open" || o.status === "draft") ? `<button class="btn small-btn ghost" onclick="closeOffer('${o.id}')">Close offer</button>` : ""}
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
  <div class="panel" style="max-width:560px;margin:0 auto">
    <h3>Counter check-in</h3>
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
      <strong>${esc(p.name)}</strong>
      <p class="small muted">${p.minMonths}-month minimum.</p>
      <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      ${u.business.plan === p.id ? `<p class="saved mt">Your current plan</p>` : ""}
    </div>`).join("");
  el.innerHTML = `
  <div class="panel">
    <h3>Your business profile</h3>
    <p class="small muted">What creators see when they weigh your offers: your name, category, neighborhood, and a short about. A written-up experience fills offers faster.</p>
    <div class="form-2col">
      <div class="field"><label>Business name</label><input id="bp-name" value="${esc(u.business.businessName)}"></div>
      <div class="field"><label>Category</label>${chipSelectHtml("bp-category", state.boot.businessCategories.map((c) => ({ value: c, label: c })), u.business.category, null, false)}</div>
    </div>
    <div class="form-2col">
      <div class="field"><label>City</label><input id="bp-city" value="${esc(u.city || "")}"></div>
      <div class="field"><label>Neighborhood / area</label><input id="bp-neighborhood" value="${esc(u.business.neighborhood || "")}" placeholder="For example: Oceanfront, Ghent"></div>
    </div>
    <div class="field"><label>About your business</label><textarea id="bp-about" rows="3" placeholder="What you serve, what the visit feels like">${esc(u.business.about || "")}</textarea></div>
    <button class="btn" onclick="saveBusinessProfile()">Save profile</button> <span id="bp-ok" class="saved"></span>
  </div>
  <div class="panel mt tint">
    <h3>Your plan</h3>
    <p>Current plan: <strong>${esc(u.business.planName)}</strong>, selected ${fmtDate(u.business.planSelectedAt)}.</p>
    <p class="muted">${esc(u.business.billingStatus)}</p>
    <p class="small"><strong>${VISIT_GUARANTEE_LINE}</strong></p>
    <p class="small">Payment stays concierge: when billing starts, Jeff sends the payment step by hand. Nothing is charged before then, and SIGNL never takes a card in the app.</p>
    <div class="plan-cards">${plans}</div>
    <input type="hidden" id="me-plan" value="${esc(u.business.plan)}">
    <button class="btn mt" onclick="savePlan()">Save plan selection</button>
    <p class="small muted mt">Until billing starts, your selection is recorded and your founding pricing stays locked while you stay subscribed.</p>
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
  <div class="panel mt tint" id="staff-settings">
    <h3>Staff redemption</h3>
    <p class="muted">Loading...</p>
  </div>
  ${accountHtml(u)}`;
  loadStaffSettings();
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
    <button class="btn danger" onclick="staffSignOutAll()">Sign out all staff devices</button> <span id="staff-out-ok" class="saved"></span>`;
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
    for (const meta of CAMPAIGN_SECTIONS) {
      const data = await api("GET", "/admin/campaign?campaignId=" + encodeURIComponent(meta.campaignId));
      (meta.kind === "business" ? businessSections : creatorSections).push(campaignSectionHtml(meta, data));
    }
    el.innerHTML = `
      <h3 style="margin:0 0 8px">Creator outreach campaigns</h3>
      <p class="small muted">Both campaigns send through the same sweep: up to 8 emails per campaign every 30 minutes while armed, only between 8:00 and 21:00 ET. One daily ceiling covers both together: 40 sends per day (ET) across all campaigns, to protect the sending domain. Hitting it is normal; the queues wait for the next day. A queue auto-pauses when it empties.</p>
      ${creatorSections.join("")}
      <h3 style="margin:24px 0 8px">Business outreach campaigns</h3>
      <p class="small muted">The founding business wave sends through the same sweep, under the same shared daily ceiling: 40 sends per day (ET) across all campaigns. Nothing sends until the campaign is armed.</p>
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
        <tr><th>Market</th><th>Status</th><th>Approved creators</th><th>Pending creators</th><th>Approved businesses</th><th>Action</th></tr>
        ${data.markets.map((m) => `<tr>
          <td><strong>${esc(m.label)}</strong><br><span class="muted small">${esc(m.country || "United States")}</span></td>
          <td>${m.live ? `<span class="badge ok">Live</span>` : `<span class="badge info">Founding only</span>`}</td>
          <td>${m.creatorsApproved}</td><td>${m.creatorsPending}</td><td>${m.businessesApproved}<br><span class="muted small">Founding list: ${m.businessesFounding || 0} &middot; Active: ${m.businessesActive || 0}</span></td>
          <td><button class="btn small-btn ${m.live ? "danger" : ""}" onclick="toggleMarket('${esc(m.name)}', ${m.live ? "false" : "true"})">${m.live ? "Deactivate" : "Activate market"}</button>${m.businessesFounding ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="activateMarketBusinesses('${esc(m.name)}')">Activate founding businesses (${m.businessesFounding})</button>` : ""}</td>
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
      const detail = u.role === "creator" && u.creator
        ? `@${esc(u.creator.handle)} (${esc(primaryLabelClient(u.creator.primaryPlatform || "instagram"))}) &middot; ${fmtNum(u.creator.followerCount)} followers &middot; ${esc(u.creator.tierBand)} &middot; Local: ${u.creator.localAudiencePct === null ? "not reported" : u.creator.localAudiencePct + "% (Self-reported)"} &middot; ${(u.creator.categories || []).map(esc).join(", ")} &middot; Photo: ${u.creator.hasPhoto ? "yes" : "no"} &middot; Socials: IG${u.creator.tiktokHandle ? ", TikTok" : ""}${u.creator.youtubeChannel ? ", YouTube" : ""}${u.creator.facebookUrl ? ", Facebook" : ""}${u.creator.xUrl ? ", X" : ""}${u.creator.linkedinUrl ? ", LinkedIn" : ""}${u.creator.neighborhood ? ` &middot; Area: ${esc(u.creator.neighborhood)}` : ""}${u.creator.profession ? ` &middot; Profession: ${esc(u.creator.profession)}` : ""}${u.creator.profession === "Real estate agent" && u.creator.farmAreas && u.creator.farmAreas.length ? ` &middot; Neighborhoods: ${u.creator.farmAreas.map(esc).join(", ")}` : ""}${u.creator.profession === "Real estate agent" && u.creator.brokerage ? ` &middot; Brokered by: ${esc(u.creator.brokerage)}` : ""}${u.creator.university || u.university ? ` &middot; University: ${esc(u.creator.university || u.university)}${universityStatusSuffix(u)}${u.universityUnverified || (u.creator && u.creator.universityUnverified) ? " (unverified)" : ""}` : ""}${u.referredBy ? ` &middot; Via referral: @${esc(u.referredBy)}` : ""}${u.signupSource ? ` &middot; Source: ${esc(u.signupSource)}` : ""}${u.momentum && u.momentum.signups ? ` &middot; Momentum: ${u.momentum.points} pts (${u.momentum.signups} joined, ${u.momentum.approved} approved)` : ""}${u.rejectionReason ? ` &middot; Rejection reason: ${esc(u.rejectionReason)}` : ""}`
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
        <td>${fmtDate(u.createdAt)}</td>
        <td>${u.status === "pending"
          ? `<button class="btn small-btn" onclick="reviewApp('${u.id}','approve')">Approve</button> <button class="btn small-btn danger" onclick="toggleRejectEditor('${u.id}')">Reject</button><div id="rej-edit-${u.id}" style="display:none;margin-top:8px;min-width:260px"><div class="field"><label>Reason (optional, named in their rejection email)</label><select id="rej-reason-${u.id}"><option value="">No reason given</option><option>Not local enough</option><option>Audience too small for this wave</option><option>Content not a fit</option><option>Market not open yet</option><option>Other</option></select></div><button class="btn small-btn danger" onclick="confirmRejectApp('${u.id}')">Send rejection</button></div>`
          : `<span class="badge ${u.status === "approved" ? "ok" : "bad"}">${esc(u.status)}</span>${u.tester ? ` <span class="badge warn">Tester</span>` : ""}${u.role === "creator" && u.status === "approved" ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="setTester('${u.id}', ${u.tester ? "false" : "true"}, 'creator')">${u.tester ? "Move to roster" : "Move to Tester"}</button>` : ""}`}${u.role === "business" && u.status === "approved" && businessAccessState(u) !== "active" ? `<br><button class="btn small-btn" style="margin-top:6px" onclick="activateBusiness('${u.id}')">Activate business</button>` : ""}${u.role === "business" && u.status === "approved" ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="setTester('${u.id}', ${u.tester ? "false" : "true"}, 'business')">${u.tester ? "Move to roster" : "Move to Tester"}</button>` : ""}${u.role === "business" && u.business ? `<br><button class="btn small-btn ghost" style="margin-top:6px" onclick="toggleReviewLinks('${u.id}')">Review links</button><div id="rl-edit-${u.id}" style="display:none;margin-top:8px;min-width:260px">${["google", "yelp", "tripadvisor", "facebook"].map((k) => `<div class="field"><label>${esc(k)}</label><input id="rl-${k}-${u.id}" type="url" value="${esc((u.business.reviewLinks || {})[k] || "")}" placeholder="https://"></div>`).join("")}<button class="btn small-btn" onclick="saveReviewLinks('${u.id}')">Save review links</button></div><br><button class="btn small-btn ghost" style="margin-top:6px" onclick="toggleDiscountEditor('${u.id}')">Code discount</button><div id="disc-edit-${u.id}" style="display:none;margin-top:8px;min-width:260px"><label style="font-weight:500"><input type="checkbox" id="disc-enabled-${u.id}" style="width:auto" ${u.business.discountEnabled ? "checked" : ""}> Code discounts on (business's opt-in)</label><div class="field"><label>Discount percent (5 to 50)</label><input id="disc-pct-${u.id}" type="number" min="5" max="50" step="1" value="${esc(String(u.business.discountPct == null ? 20 : u.business.discountPct))}"></div><button class="btn small-btn" onclick="saveDiscountSetting('${u.id}')">Save code discount</button></div>` : ""}</td>
      </tr>`;
    };
    const s = data.summary;
    const summaryStrip = s ? `
      <h3>Founding roster counts</h3>
      <p class="muted small">Creators only, counted from the records. Approved + profile complete is the launch number: only those creators show up for businesses.</p>
      <div class="table-wrap panel"><table><tr><th>Market</th><th>Pending</th><th>Approved</th><th>Approved + profile complete</th></tr>
      ${s.markets.map((m) => `<tr><td>${esc(m.label)}</td><td>${m.pending}</td><td>${m.approved}</td><td>${m.approvedComplete}</td></tr>`).join("")}
      <tr><td><strong>All markets</strong></td><td><strong>${s.all.pending}</strong></td><td><strong>${s.all.approved}</strong></td><td><strong>${s.all.approvedComplete}</strong></td></tr>
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
  state.preview = { step: "plans", planId: "self-service", market: "Virginia Beach", creators: null, creator: null, targetId: "", sent: [], confirmation: null, dashboard: null };
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
  else if (pv.step === "staffdemo") main.innerHTML = pvStaffDemoHtml();
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
      <strong>${esc(p.name)}</strong>
      <p class="small muted">${p.minMonths}-month minimum.</p>
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
      <div class="field"><label>How many people does the comp cover?</label>
        <div class="radio-stack">
        <label class="radio-chip"><input type="radio" name="pvo-covers" value="1" checked><span>1 person: just the creator</span></label>
        <label class="radio-chip"><input type="radio" name="pvo-covers" value="2"><span>2 people: the creator and a guest</span></label>
        </div>
      </div>
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
    html += `<button class="btn small-btn ghost" disabled>Use in an ad</button> <span class="small muted">Ad use comes with paid visits (repost plus ads for 6 months from the post date); the creator is notified and earns +25 Momentum. Disabled in preview; try it live from a paid visit.</span>`;
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
    <p class="muted small">The Counter screen. In the live app this is the whole job: the creator shows their code or QR, staff look it up, one tap redeems it and starts the 48 hour clock. The register is never involved; staff ring the comp in your own system the way they normally do.</p>
    ${demo ? `
    <div class="notice blue">
      <strong>Try the staff login yourself (simulation).</strong> This demo runs the full staff flow against ${esc(demo.businessName)} in preview: PIN screen, code lookup, redeem. Nothing is saved and no real record changes.
      <div class="grid cols-2" style="margin-top:10px">
        <p class="small" style="margin:0"><strong>Business (staff) code:</strong> <span class="code">${esc(demo.staffCode)}</span><br><strong>Register link:</strong> ${esc(demo.registerPath)}<br><strong>Demo staff PIN:</strong> <span class="code">${esc(demo.demoPin)}</span></p>
        <p class="small" style="margin:0"><strong>Sample creator code to redeem:</strong> <span class="code">${esc(demo.redeemCode || "")}</span><br><span class="muted">${demo.redeemVisit ? `${esc(demo.redeemVisit.title)} with @${esc(demo.redeemVisit.creatorHandle)} &middot; ${coversLine(demo.redeemVisit)}` : ""}</span></p>
      </div>
      <div class="cta-row" style="justify-content:flex-start;margin-top:10px">
        <button class="btn" onclick="return pvStaffEnter()">Open the staff demo</button>
      </div>
      <div class="field" style="margin-top:10px;max-width:340px"><label>Set your own demo PIN for this session (4 to 6 digits)</label><input id="pv-demo-pin" inputmode="numeric" maxlength="6" placeholder="${esc(demo.demoPin)}"></div>
      <button class="btn small-btn ghost" onclick="return pvStaffSetPin()">Use this PIN for the demo</button> <span id="pv-demo-pin-ok" class="saved"></span>
      <p class="small muted" style="margin-bottom:0">In the live app the owner sets the real staff PIN on the Plan tab, and staff open this same flow from the sign-in screen or the register card link. The demo PIN above exists only inside this preview.</p>
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
        <button class="btn" type="submit" style="width:100%">Look up the visit</button>
      </form>
      <p class="small muted">Try the sample code <span class="code">${esc(demo.redeemCode || "")}</span> (${esc(v.title || "the booked visit")}${v.creatorHandle ? `, @${esc(v.creatorHandle)}` : ""}). ${demo.burnedExample ? `Or try the already-used code <span class="code">${esc(demo.burnedExample.code)}</span> to see the codes-work-once answer.` : ""}</p>
      ${s.found ? pvStaffFoundHtml(s.found) : ""}
      <p class="mt"><button class="btn ghost" onclick="return pvStaffExit()">Done: back to the dashboard</button></p>
    </section>`;
  }
  return `
  <section class="panel center" style="max-width:520px;margin:10px auto">
    <h2 style="margin-top:0">Visit redeemed</h2>
    ${banner}
    <p><strong>${esc(s.redeemedName || "The creator")}</strong> is redeemed in this simulation. Their 48 hour post clock would start now, and the owner would get the staff notice email.</p>
    <p class="muted">In the live app the code burns for real. Here nothing was saved: run it again any time.</p>
    <button class="btn" onclick="return pvStaffAgain()">Redeem another (back to the code screen)</button>
    <button class="btn ghost" onclick="return pvStaffExit()">Back to the dashboard</button>
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
    ${mv.discountCodes && !mv.discountCodes.enabled ? `<p class="small muted"><strong>Audience-code discounts: off.</strong> Harbor Table has not turned code discounts on, so its creator codes are counting codes only: they track the customers a post sends in, and promise no percentage off. Turning them on, and picking the percentage, is the business's call whenever it wants.</p>` : ""}
    ${rows || `<p class="small muted">No paid bookings yet this month.</p>`}
    <p class="small muted">Paid bookings are the optional lane: a specific creator at their own listed rate, 6% total fee split evenly (business +3%, creator keeps 97%). Comp-only is always fine, forever. ${b.paidBookings && b.paidBookings.length ? esc(b.paidBookings[0].paymentNote) : ""}</p>
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
    <div class="notice" style="margin-top:16px"><strong>${h.attention.length} item${h.attention.length === 1 ? "" : "s"} need${h.attention.length === 1 ? "s" : ""} your attention.</strong>
    ${h.attention.map((a) => `<br><strong>${esc(a.label)}:</strong> ${esc(a.detail)}`).join("")}</div>`
    : `<div class="notice blue" style="margin-top:16px"><strong>Nothing needs your attention.</strong> Every visit is on track.</div>`;
  const content = (h.topContent || []).map((c) => `
    <div class="ui-row"><span class="k"><strong>${esc(c.title)}</strong> with @${esc(c.creatorHandle)}<br><span class="small muted">${fmtNum(c.views)} views &middot; ${fmtNum(c.likes)} likes &middot; ${c.onTime ? "posted on time" : "posted late"}${c.roasScore !== null && c.roasScore !== undefined ? ` &middot; SIGNL ROAS ${c.roasScore.toFixed(2)}&times;` : ""}${c.performanceUpdatedAt ? `<br>${perfSourceLabel(c.performanceSource)}, updated ${fmtDay(c.performanceUpdatedAt)}` : ""}</span></span><span class="v">${c.redemptions ? `${c.redemptions.count} code uses<br>$${fmtMoney(c.redemptions.basketTotal)} rung up` : "No tally yet"}</span></div>`).join("");
  const next = (h.nextVisits || []).map((n) => `
    <div class="ui-row"><span class="k"><strong>${esc(n.title)}</strong> with @${esc(n.creatorHandle)}<br><span class="small muted">${esc(n.stateLabel)}${n.dueInLabel ? ` &middot; ${esc(n.dueInLabel)}` : ""}</span></span><span class="v">${esc(n.whenLabel)}<br><span class="pv-tick" data-kind="left" data-target="${esc(n.when || "")}"></span></span></div>`).join("");
  return `
  <section class="panel">
    <h3 style="margin-top:0"><span class="preview-tag">PREVIEW</span> Business home</h3>
    <p class="small muted">The first screen a business opens: what is happening, what needs attention, and what it is returning. Built from the same simulated visits as everything below it.</p>
    <div class="stat-band home-metrics">
      <div class="stat-cell"><div class="stat-num">${h.visitsUsed}<span class="small muted"> of ${h.visitsAllowance}</span></div><div class="stat-lbl">Creator visits booked this month (${h.visitsRemaining} left on the plan)</div></div>
      <div class="stat-cell"><div class="stat-num">${h.postsLive}</div><div class="stat-lbl">Posts live</div></div>
      ${roasCellHtml(h, false)}
      <div class="stat-cell"><div class="stat-num">${h.onTimeRatePct === null ? "n/a" : h.onTimeRatePct + "%"}</div><div class="stat-lbl">Posts on time</div></div>
    </div>
    ${attention}
    <h4>Visit pipeline</h4>
    <div class="pv-funnel">${stages.map(([n, label, sub]) => `<div class="pv-stage"><div class="pv-stage-num">${n}</div><div class="pv-stage-lbl">${label}</div><div class="pv-stage-sub">${sub}</div></div>`).join("")}</div>
    <p class="small muted">Each stage counts the simulated bookings that have reached it, from invitation to a live post.</p>
    <h4>Plan pace</h4>
    <div class="flex-between"><span class="small"><strong>${esc(d.plan.name)} plan:</strong> ${h.visitsUsed} of ${h.visitsAllowance} visits booked this month</span><span class="badge ${h.planPacePct >= 100 ? "warn" : "info"}">${h.planPacePct}%</span></div>
    <div class="meter" style="margin-top:8px"><i style="width:${Math.min(100, h.planPacePct)}%"></i></div>
    ${content ? `<div class="tint-block"><h4>Content that is working</h4>
    <p class="small muted">Delivered posts ranked by the register action they produced: the code tallies reported on each visit, with views as supporting detail.</p>${content}</div>` : ""}
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
      <div><h3 style="margin:0">${esc(d.business.name)}</h3><p class="muted small" style="margin:4px 0 0">${esc(d.business.category)} &middot; ${esc(marketDisplayName(d.business.market))} &middot; ${esc(s.cycleLabel)} cycle</p></div>
      <span class="badge info">${esc(plan.name)} plan &middot; $${fmtPrice(plan.priceMonthly)}/mo &middot; ${plan.visitsPerMonth} visits/mo</span>
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
      <div class="stat"><div class="num">$${fmtMoney(s.compValueGiven)}</div><div class="lbl">Comp given, at cost (modeled)</div></div>
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
    <div class="showcase-block"><h4>Content rights: they follow the visit</h4>
      <p class="small" style="margin:0 0 4px"><span class="rules">On a comp visit (every plan, including ${esc(plan.name)}):</span> share a delivered post natively, with the creator tagged. No downloads, no reposting the file, no ads.</p>
      <p class="small" style="margin:0 0 4px"><span class="rules">On a paid visit:</span> you can also repost the post on your own feed and run it as an ad for 6 months from the post date.</p>
      <p class="small muted" style="margin:0">The creator always owns their content, and nobody can edit it. Rights follow the visit, not the plan, and are shown to the creator before they accept, so there are no surprises on either side.</p>
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
    const bizParams = parseBizParams(params);
    if (!claim.handle && (bizParams.businessName || bizParams.market || bizParams.category)) {
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
    render();
    if (state.user) refreshBadges();
    if (code && state.user && state.user.role === "business" && state.tab === "Counter") {
      setTimeout(() => renderCounter(code.toUpperCase()), 60);
    }
  } catch (e) {
    app.innerHTML = `<div style="max-width:560px;margin:40px auto"><div class="error-box">SIGNL could not load. ${esc(e.message)}</div><p class="mt"><button class="btn" onclick="location.reload()">Reload</button></p></div>`;
  }
})();
