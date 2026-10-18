// SIGNL app (app.joinsignl.com). Single-page client for the SIGNL API.
"use strict";

const state = {
  user: null,
  boot: null, // markets, tiers, categories, plans
  view: "home",
  tab: null,
  discover: [],
  threads: [],
  activeThread: null, // other user id
  counterCode: "",
};

const app = document.getElementById("app");
const topnav = document.getElementById("topnav");

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

function fmtNum(n) {
  if (n === null || n === undefined) return "n/a";
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
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
    return;
  }
  const u = state.user;
  const label = u.role === "business" && u.business ? u.business.businessName : u.name;
  topnav.innerHTML = `
    <span class="muted small">${esc(label)} &middot; ${esc(u.role)}</span>
    <a href="#" onclick="return go('dashboard')">Dashboard</a>
    <button class="linklike" onclick="signOut()">Sign out</button>`;
}

function go(view, tab) {
  state.view = view;
  if (tab) state.tab = tab;
  render();
  return false;
}

async function render() {
  renderNav();
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
    <p class="small muted mt">Founding creator sign-up is open now in all 11 markets. Markets open to businesses in the next 60 to 90 days.</p>
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

function marketOptions(selected) {
  return state.boot.markets.map((m) => `<option value="${esc(m.name)}" ${m.name === selected ? "selected" : ""}>${esc(m.label)}</option>`).join("");
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

function tierOptions(selected) {
  return state.boot.tiers.map((t) => `<option value="${esc(t.id)}" ${t.id === selected ? "selected" : ""}>${esc(t.label)} (${t.min >= 1000 ? t.min / 1000 + "k" : t.min} to ${t.max === Infinity ? "any" : t.max >= 1000 ? t.max / 1000 + "k" : t.max} followers)</option>`).join("");
}

function suggestedTierId(followers) {
  const n = Number(followers) || 0;
  if (n >= 15000) return "Creators";
  if (n >= 2000) return "Locals";
  return "Neighbors";
}

function syncSuggestedTier() {
  const f = document.getElementById("jc-followers");
  const sel = document.getElementById("jc-tier");
  if (f && sel) sel.value = suggestedTierId(f.value);
  const hint = document.getElementById("jc-tier-hint");
  if (hint && f) hint.textContent = `Suggested from your follower count: ${suggestedTierId(f.value)}. Confirm your band, or pick another.`;
}

function renderJoinCreator() {
  const cats = state.boot.creatorCategories.map((c) => `<label><input type="checkbox" name="c-cat" value="${esc(c)}"> ${esc(c)}</label>`).join("");
  const comps = state.boot.compCategories.map((c) => `<label><input type="checkbox" name="c-comp" value="${esc(c)}"> ${esc(c)}</label>`).join("");
  app.innerHTML = `
  <section class="panel" style="max-width:680px;margin:10px auto">
    <h2>Become a Founding Creator</h2>
    <p class="muted">SIGNL is opening market by market, and creators are signing up first. Build your full founding profile now: when your market opens to businesses in the next 60 to 90 days, we email you, and founding creators get priority when businesses search. This is not a waitlist form; this is your real profile.</p>
    <div id="form-error"></div>
    <form onsubmit="return doRegisterCreator(event)">
      <div class="form-2col">
        <div class="field"><label>Full name</label><input id="jc-name" required autocomplete="name"></div>
        <div class="field"><label>Email (how we reach you at launch)</label><input type="email" id="jc-email" required autocomplete="email"></div>
      </div>
      <div class="field"><label>Password (10+ characters)</label><input type="password" id="jc-password" required minlength="10" autocomplete="new-password"></div>
      <div class="form-2col">
        <div class="field"><label>Your market</label><select id="jc-market" onchange="document.getElementById('jc-city').innerHTML = cityOptions(this.value)">${marketOptions("Hampton Roads")}</select></div>
        <div class="field"><label>Your home city</label><select id="jc-city">${cityOptions("Hampton Roads")}</select></div>
      </div>
      <div class="form-2col">
        <div class="field"><label>Instagram handle (required)</label><input id="jc-handle" placeholder="yourhandle" required oninput="document.getElementById('jc-ig-link').textContent = this.value ? 'instagram.com/' + this.value.replace(/^@/, '') : ''"><p class="small muted" id="jc-ig-link"></p></div>
        <div class="field"><label>TikTok handle (optional)</label><input id="jc-tiktok" placeholder="yourhandle"></div>
      </div>
      <div class="field"><label>YouTube channel (optional)</label><input id="jc-youtube" placeholder="Channel name or URL"></div>
      <div class="form-2col">
        <div class="field"><label>Facebook profile or Page (optional)</label><input id="jc-facebook" placeholder="facebook.com/yourpage or full URL"></div>
        <div class="field"><label>X (Twitter) handle or URL (optional)</label><input id="jc-x" placeholder="yourhandle or x.com/yourhandle"></div>
      </div>
      <div class="field"><label>LinkedIn profile (optional)</label><input id="jc-linkedin" placeholder="linkedin.com/in/yourname or full URL"></div>
      <div class="form-2col">
        <div class="field"><label>Followers (required)</label><input type="number" id="jc-followers" min="0" required placeholder="For example 8400" oninput="syncSuggestedTier()"></div>
        <div class="field"><label>Your tier band (confirm)</label><select id="jc-tier">${tierOptions("Neighbors")}</select><p class="small muted" id="jc-tier-hint">Enter your followers and we will suggest your band.</p></div>
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
      <div class="field"><label>Short bio</label><textarea id="jc-bio" rows="2" placeholder="What do you post, where do you go, what do you love locally?"></textarea></div>
      <div class="field"><label>Profile photo (optional, add now or later)</label><input type="file" id="jc-photo" accept="image/png,image/jpeg,image/webp"><p class="small muted">PNG, JPEG, or WebP, under 2.5 MB. Businesses see this on your profile when your market opens.</p></div>
      <div class="notice blue">The deal: businesses comp you a meal or service, you post your honest experience within 48 hours of the visit, and you disclose the comp in the post. Nobody can ask you for a positive post. Ever.</div>
      <div class="field"><label style="font-weight:500"><input type="checkbox" id="jc-agree-honest" style="width:auto" required> I understand no business can require me to post positively. My posts stay my honest opinion.</label></div>
      <div class="field"><label style="font-weight:500"><input type="checkbox" id="jc-agree-ftc" style="width:auto" required> I agree to clearly disclose every comp in my posts, as the FTC requires.</label></div>
      <button class="btn" type="submit" style="width:100%">Create my founding profile</button>
      <p class="small muted mt">Every application is reviewed by a person. Founding spots are limited in every market, and priority goes in sign-up order.</p>
    </form>
  </section>`;
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
  const topCities = document.getElementById("jc-topcities").value.split(",").map((x) => x.trim()).filter(Boolean);
  try {
    const data = await api("POST", "/auth/register", {
      role: "creator",
      name: document.getElementById("jc-name").value,
      email: document.getElementById("jc-email").value,
      password: document.getElementById("jc-password").value,
      market: document.getElementById("jc-market").value,
      city: document.getElementById("jc-city").value,
      handle: document.getElementById("jc-handle").value,
      tiktokHandle: document.getElementById("jc-tiktok").value,
      youtubeChannel: document.getElementById("jc-youtube").value,
      facebookUrl: document.getElementById("jc-facebook").value,
      xHandle: document.getElementById("jc-x").value,
      linkedinUrl: document.getElementById("jc-linkedin").value,
      tierBand: document.getElementById("jc-tier").value,
      followerCount: parseInt(document.getElementById("jc-followers").value, 10) || 0,
      avgViews: parseInt(document.getElementById("jc-avgviews").value, 10) || 0,
      localAudiencePct: Number(document.getElementById("jc-localpct").value),
      topAudienceCities: topCities,
      categories: cats,
      compCategories: comps,
      bio: document.getElementById("jc-bio").value,
      agreedHonestPosts: true,
      agreedFtcDisclosure: true,
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
    <p>SIGNL is building its founding creator rosters first, market by market. Business accounts open when your market launches, in the next 60 to 90 days. Until then, founding businesses join by list, not by account.</p>
    <p><strong>Why join the list now:</strong> the price on this page is the founding price. Join the founding business list and you lock it in. When your market opens, your account activates at founding pricing while later businesses pay the standard rate.</p>
    <div class="plan-cards">${plans}</div>
    <div class="notice blue mt">Founding pricing: Self-Service $299/mo, Managed $799/mo, 3-month minimum. Joining the list costs nothing and charges nothing. It holds your price and your place in your market's launch.</div>
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
  app.innerHTML = `
  <section class="panel center" style="max-width:560px;margin:40px auto">
    <h2>${isCreator ? "Founding profile received" : "Application received"}</h2>
    <p>Thanks, ${esc(u.name)}. ${isCreator ? `Your founding creator profile for <strong>${esc(u.market)}</strong> is built and in the review queue.` : "Every SIGNL application is reviewed by a person before accounts activate. Yours is in the queue."}</p>
    ${isCreator && f.queuePosition ? `<p><span class="badge info">You are #${f.queuePosition} in the ${esc(u.market)} founding queue</span></p>` : ""}
    <p class="muted">${isCreator
      ? `Every application is reviewed by a person. The moment you are approved, your founding status page opens here, and we will email you at ${esc(u.email)} when ${esc(u.market)} opens to businesses in the next 60 to 90 days. Sign back in any time to check your status.`
      : "Sign back in any time to check your status; your dashboard opens the moment you are approved."}</p>
    ${isCreator && !(u.creator && u.creator.hasPhoto) ? `
    <div style="text-align:left">
      <div class="field"><label>Add your profile photo now (optional)</label><input type="file" id="pending-photo" accept="image/png,image/jpeg,image/webp"></div>
      <button class="btn small-btn" onclick="return uploadPendingPhoto(event)">Upload photo</button> <span id="pending-photo-ok" class="saved"></span>
    </div>` : ""}
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

function creatorCard(c, viewer) {
  const p = c.profile || {};
  const localTxt = p.localAudiencePct === null || p.localAudiencePct === undefined
    ? "Local audience not reported yet"
    : `${p.localAudiencePct}% local audience <span class="badge info">${esc(p.localAudienceSource || "Self-reported")}</span>`;
  return `
  <div class="card">
    <div class="flex-between">
      <div>${c.photoUrl ? `<img class="avatar" src="${esc(c.photoUrl)}" alt="">` : ""}<strong>${esc(c.name)}</strong> <span class="muted">@${esc(p.handle || "")}</span></div>
      <button class="heart ${c.isFavorite ? "on" : ""}" title="Save to favorites" onclick="toggleFav('${c.userId}')">${c.isFavorite ? "&#10084;" : "&#9825;"}</button>
    </div>
    <p class="small muted">${esc(c.market)} &middot; ${esc(p.tierBand || "")} &middot; ${fmtNum(p.followerCount)} followers &middot; ${fmtNum(p.avgViews)} avg views${c.foundingPriority ? ` &middot; Founding priority #${c.foundingPriority}` : ""}</p>
    <p>${localTxt}</p>
    <p>${scoreBadge(c.localImpactScore)}</p>
    ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
    ${p.compCategories && p.compCategories.length ? `<p class="small muted">Open to comps: ${p.compCategories.map(esc).join(", ")}</p>` : ""}
    ${p.bio ? `<p class="small muted">${esc(p.bio)}</p>` : ""}
    <p class="small">${socialLinksHtml(p)}</p>
    <div class="cta-row" style="justify-content:flex-start">
      <button class="btn small-btn" onclick="startOffer('${c.userId}')">Send offer</button>
      <button class="btn small-btn ghost" onclick="openThread('${c.userId}')">Message</button>
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
  if (tab === "Profile") body = creatorProfileHtml(u);
  app.innerHTML = `
    <h2>Creator dashboard <span class="badge ok">Founding Creator, ${esc(u.market)}</span></h2>
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
    el.innerHTML = `
    <div class="panel">
      <div class="flex-between">
        <div>
          <h3 style="margin:0">${esc(state.user.name)} <span class="muted">@${esc(p.handle || "")}</span></h3>
          <p class="muted small">${esc(f.market)} &middot; ${esc(f.city)}</p>
        </div>
        <span class="badge ok" style="font-size:0.95rem;padding:6px 14px">Founding Creator, ${esc(f.market)}</span>
      </div>
      <div class="grid cols-2 mt">
        <div>
          ${card.photoUrl ? `<img class="profile-photo" src="${esc(card.photoUrl)}" alt="Your profile photo">` : `<div class="photo-placeholder">No photo yet. Add one in your profile below; businesses see it when ${esc(f.market)} opens.</div>`}
          <p>${p.localAudiencePct}% local audience <span class="badge info">${esc(p.localAudienceSource || "Self-reported")}</span></p>
          <p>${scoreBadge(card.localImpactScore)}</p>
          ${card.scoreComponents ? `<p class="small muted">Reliability ${card.scoreComponents.reliability} &middot; ${esc(card.scoreComponents.reliabilityBasis)}</p>` : ""}
        </div>
        <div>
          <p class="small"><strong>${fmtNum(p.followerCount)}</strong> followers &middot; ${esc(p.tierBand || "")} tier ${p.avgViews ? "&middot; " + fmtNum(p.avgViews) + " typical views" : ""}</p>
          ${p.categories && p.categories.length ? `<p class="small">${p.categories.map((x) => `<span class="badge">${esc(x)}</span>`).join(" ")}</p>` : ""}
          ${p.compCategories && p.compCategories.length ? `<p class="small muted">Open to comps: ${p.compCategories.map(esc).join(", ")}</p>` : ""}
          ${p.topAudienceCities && p.topAudienceCities.length ? `<p class="small muted">Top audience cities: ${p.topAudienceCities.map(esc).join(", ")}</p>` : ""}
          ${p.bio ? `<p class="small muted">${esc(p.bio)}</p>` : ""}
          <p class="small">
            ${socialLinksHtml(p)}
          </p>
        </div>
      </div>
    </div>
    <div class="panel">
      <h3 style="margin-top:0">${esc(f.market)} opens to businesses in the next ${esc(f.launchWindow)}</h3>
      <p>Your market is not taking business offers yet, and that is on purpose: SIGNL opens each market with its founding roster in place. The moment ${esc(f.market)} opens, we email you at <strong>${esc(state.user.email)}</strong>.</p>
      ${f.priorityPosition ? `<p><span class="badge tier" style="font-size:0.95rem;padding:6px 14px">Founding priority #${f.priorityPosition} in ${esc(f.market)}</span></p>
      <p class="muted">You signed up early, and it counts: when businesses search the ${esc(f.market)} roster, founding creators are ordered by sign-up time, earliest first. ${f.foundingCreatorsInMarket > 1 ? `You are one of ${f.foundingCreatorsInMarket} approved founding creators in your market so far.` : "You are the first approved founding creator in your market."}</p>` : ""}
      <p class="muted">Offers, visits, and messages unlock here the day your market activates. Keep your profile current in the meantime; your local audience percentage is what businesses look at first.</p>
    </div>`;
    profEl.innerHTML = `<h3 class="mt">Your profile</h3>` + creatorProfileHtml(state.user);
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function creatorProfileHtml(u) {
  const c = u.creator || {};
  const cats = state.boot.creatorCategories.map((x) => `<label><input type="checkbox" name="p-cat" value="${esc(x)}" ${c.categories && c.categories.includes(x) ? "checked" : ""}> ${esc(x)}</label>`).join("");
  const comps = state.boot.compCategories.map((x) => `<label><input type="checkbox" name="p-comp" value="${esc(x)}" ${c.compCategories && c.compCategories.includes(x) ? "checked" : ""}> ${esc(x)}</label>`).join("");
  const tiers = state.boot.tiers.map((t) => `<option value="${esc(t.id)}" ${c.tierBand === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("");
  return `
  <div class="panel">
    <div class="flex-between">
      <div>
        <h3 style="margin:0">${esc(u.name)} <span class="muted">@${esc(c.handle || "")}</span></h3>
        <p class="muted small">${esc(u.market)} &middot; ${esc(u.city || "")}</p>
      </div>
      <div id="my-score"><span class="badge info">Loading score...</span></div>
    </div>
    <p class="small muted">Your Local Impact Score is computed only from your stored profile and your real visit history on SIGNL. Your local audience figure shows as <strong>Self-reported</strong> until Instagram verification is available.</p>
    <div id="form-error"></div>
    <form onsubmit="return doUpdateCreator(event)">
      <div class="field"><label>Profile photo</label>
        ${c.hasPhoto ? `<img class="profile-photo" src="/api/users/${esc(u.id)}/photo" alt="Your profile photo">` : `<div class="photo-placeholder">No photo yet.</div>`}
        <input type="file" id="p-photo" accept="image/png,image/jpeg,image/webp">
        <p class="small muted">Pick a new photo and save to replace it. PNG, JPEG, or WebP, under 2.5 MB.</p>
      </div>
      <div class="form-2col">
        <div class="field"><label>Instagram handle</label><input id="p-handle" value="${esc(c.handle || "")}"></div>
        <div class="field"><label>Home city (${esc(u.market)})</label><select id="p-city">${cityOptions(u.market, u.city || "")}</select></div>
      </div>
      <div class="form-2col">
        <div class="field"><label>TikTok handle</label><input id="p-tiktok" value="${esc(c.tiktokHandle || "")}" placeholder="Optional"></div>
        <div class="field"><label>YouTube channel</label><input id="p-youtube" value="${esc(c.youtubeChannel || "")}" placeholder="Optional"></div>
      </div>
      <div class="form-2col">
        <div class="field"><label>Facebook profile or Page</label><input id="p-facebook" value="${esc(c.facebookUrl || "")}" placeholder="Optional"></div>
        <div class="field"><label>X (Twitter) handle or URL</label><input id="p-x" value="${esc(c.xHandle || "")}" placeholder="Optional"></div>
      </div>
      <div class="field"><label>LinkedIn profile URL</label><input id="p-linkedin" value="${esc(c.linkedinUrl || "")}" placeholder="Optional"></div>
      <div class="form-2col">
        <div class="field"><label>Tier band</label><select id="p-tier">${tiers}</select></div>
        <div class="field"><label>Followers</label><input type="number" id="p-followers" min="0" value="${c.followerCount || 0}"></div>
      </div>
      <div class="form-2col">
        <div class="field"><label>Typical post views</label><input type="number" id="p-avgviews" min="0" value="${c.avgViews || 0}"></div>
        <div class="field"><label>Local audience share (%)</label><input type="number" id="p-localpct" min="0" max="100" value="${c.localAudiencePct === null || c.localAudiencePct === undefined ? "" : c.localAudiencePct}"></div>
      </div>
      <div class="field"><label>Top audience cities</label><input id="p-topcities" value="${esc((c.topAudienceCities || []).join(", "))}" placeholder="Up to 5, comma separated"></div>
      <div class="field"><label>What you create in</label><div class="checkrow">${cats}</div></div>
      <div class="field"><label>Comps you would accept</label><div class="checkrow">${comps}</div></div>
      <div class="field"><label>Bio</label><textarea id="p-bio" rows="2">${esc(c.bio || "")}</textarea></div>
      <button class="btn" type="submit">Save profile</button> <span id="save-ok" class="saved"></span>
    </form>
  </div>`;
}

async function loadMyScore() {
  try {
    // The founding endpoint returns the creator's own card with the
    // computed score; it works before and after their market activates.
    const data = await api("GET", "/me/founding");
    const mine = data.card;
    const el = document.getElementById("my-score");
    if (el && mine) el.innerHTML = scoreBadge(mine.localImpactScore) + (mine.scoreComponents ? `<div class="small muted mt">Local ${mine.scoreComponents.localAudiencePct}% (${esc(mine.scoreComponents.localAudienceSource)}) &middot; Reliability ${mine.scoreComponents.reliability} &middot; ${esc(mine.scoreComponents.reliabilityBasis)}</div>` : "");
  } catch (e) { /* non-fatal */ }
}

async function doUpdateCreator(e) {
  e.preventDefault();
  const cats = Array.from(document.querySelectorAll("input[name=p-cat]:checked")).map((x) => x.value);
  const comps = Array.from(document.querySelectorAll("input[name=p-comp]:checked")).map((x) => x.value);
  const pctRaw = document.getElementById("p-localpct").value;
  try {
    const uploaded = await uploadPhotoInput("p-photo");
    const data = await api("PATCH", "/me/profile", {
      handle: document.getElementById("p-handle").value,
      city: document.getElementById("p-city").value,
      tiktokHandle: document.getElementById("p-tiktok").value,
      youtubeChannel: document.getElementById("p-youtube").value,
      facebookUrl: document.getElementById("p-facebook").value,
      xHandle: document.getElementById("p-x").value,
      linkedinUrl: document.getElementById("p-linkedin").value,
      tierBand: document.getElementById("p-tier").value,
      followerCount: parseInt(document.getElementById("p-followers").value, 10) || 0,
      avgViews: parseInt(document.getElementById("p-avgviews").value, 10) || 0,
      localAudiencePct: pctRaw === "" ? null : Number(pctRaw),
      topAudienceCities: document.getElementById("p-topcities").value.split(",").map((x) => x.trim()).filter(Boolean),
      categories: cats,
      compCategories: comps,
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
    el.innerHTML = data.offers.map((o) => `
      <div class="card mb">
        <div class="flex-between"><strong>${esc(o.title)}</strong><span class="badge tier">${esc(o.businessName)}</span></div>
        <p>${esc(o.whatComped)}</p>
        <p class="small muted">Comp cap $${o.dollarCap} &middot; Visit window: ${esc(o.visitWindow || "Flexible")} &middot; ${o.bookedCount}/${o.spots} spots booked ${o.creatorId ? "&middot; Sent directly to you" : "&middot; Open to your market"}</p>
        <form onsubmit="return acceptOffer(event, '${o.id}')">
          <div class="form-2col">
            <div class="field"><label>Visit date</label><input type="date" id="vd-${o.id}" required></div>
            <div class="field"><label>&nbsp;</label><button class="btn small-btn" type="submit">Accept and get my code</button></div>
          </div>
        </form>
        ${o.creatorId ? `<button class="btn small-btn danger" onclick="declineOffer('${o.id}')">Decline</button>` : ""}
        <button class="btn small-btn ghost" onclick="openThread('${o.businessId}')">Message business</button>
      </div>`).join("");
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function acceptOffer(e, offerId) {
  e.preventDefault();
  try {
    const data = await api("POST", `/offers/${offerId}/accept`, { visitDate: document.getElementById("vd-" + offerId).value });
    state.tab = "My Visits";
    render();
    setTimeout(() => alert(`Booked. Your one-time code is ${data.booking.code}. Show it at the visit; staff redeem it in the app and your 48 hour post clock starts.`), 50);
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

function visitCard(b, role) {
  const post = b.post;
  let html = `
  <div class="card mb">
    <div class="flex-between"><strong>${esc(b.title)}</strong>${postStateBadge(b.postState, b)}</div>
    <p class="small muted">${role === "creator" ? esc(b.businessName) : "@" + esc(b.creatorHandle) + " (" + esc(b.creatorName) + ")"} &middot; ${esc(b.market)} &middot; Comp: ${esc(b.whatComped)} (cap $${b.dollarCap}) &middot; Visit: ${esc(b.visitDate || b.visitWindow || "Flexible")}</p>`;
  if (role === "creator" && b.codeStatus === "issued") {
    html += `
    <div class="grid cols-2">
      <div>
        <p class="small muted" style="margin-bottom:0">Your one-time visit code. Show this at the visit; staff redeem it in the app and your 48 hour clock starts at that moment.</p>
        <div class="code-display">${esc(b.code)}</div>
        ${b.checkinAt ? `<p class="small">You checked in at ${fmtDate(b.checkinAt)}. Waiting for the business to confirm.</p>` : `<button class="btn small-btn ghost" onclick="checkIn('${b.id}')">I am here (check in)</button>`}
      </div>
      <div class="qr-box"><img src="/api/bookings/${b.id}/qr" alt="QR code for ${esc(b.code)}" onerror="this.parentElement.style.display='none'"></div>
    </div>`;
  }
  if (role === "business" && b.codeStatus === "issued") {
    html += `<p class="small">Booking code <strong>${esc(b.code)}</strong>. Redeem it at the Counter tab when the creator is with you${b.checkinAt ? ", or confirm the visit below (creator checked in " + fmtDate(b.checkinAt) + ")" : ", or confirm the visit below if the code cannot be scanned"}.</p>
    <button class="btn small-btn" onclick="confirmVisit('${b.id}')">Confirm visit and start the 48h clock</button>`;
  }
  if (b.redeemedAt) {
    html += `<p class="small muted">Redeemed ${fmtDate(b.redeemedAt)} (${b.redeemMethod === "business_confirm" ? "business confirmed" : "code at counter"}). Post deadline: <strong>${fmtDate(b.postDeadline)}</strong>.</p>`;
  }
  if (role === "creator" && b.redeemedAt && !post) {
    html += `
    <form onsubmit="return submitPost(event, '${b.id}')">
      <div class="field"><label>Link to your post</label><input id="post-url-${b.id}" type="url" placeholder="https://www.instagram.com/p/..." required></div>
      <label style="font-weight:500"><input type="checkbox" id="post-disc-${b.id}" style="width:auto"> My post clearly discloses the comp (for example #ad or "comped by the business"), as the FTC requires.</label>
      <p class="small muted">Post your honest experience. Nobody can require a positive post.</p>
      <button class="btn small-btn" type="submit">Submit post</button>
    </form>`;
  }
  if (post) {
    html += `<p class="small">Post: <a href="${esc(post.url)}" target="_blank" rel="noopener">${esc(post.url)}</a> &middot; submitted ${fmtDate(post.submittedAt)} (${post.hoursAfterRedeem}h after redemption) ${post.verifiedAt ? "&middot; <span class='saved'>Verified by the business</span>" : ""}</p>`;
    if (role === "business" && !post.verifiedAt) html += `<button class="btn small-btn ghost" onclick="verifyPost('${post.id}')">Verify post is live</button>`;
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
      <div><label>Market</label><select id="f-market">${state.boot.markets.map((m) => `<option ${m.name === u.market ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>
      <div><label>Tier</label><select id="f-tier"><option value="">All tiers</option>${state.boot.tiers.map((t) => `<option>${esc(t.id)}</option>`).join("")}</select></div>
      <div><label>Category</label><select id="f-category"><option value="">All categories</option>${state.boot.creatorCategories.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
      <div><label>Search</label><input id="f-q" placeholder="Name or handle"></div>
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

async function loadMyOffers() {
  const el = document.getElementById("tab-body");
  const target = state.offerTarget ? state.discover.find((c) => c.userId === state.offerTarget) : null;
  let html = `
  <div class="panel">
    <h3>Create a comp offer</h3>
    <div id="form-error"></div>
    <form onsubmit="return createOffer(event)">
      <input type="hidden" id="o-creator" value="${target ? esc(target.userId) : ""}">
      ${target ? `<div class="notice blue">Sending directly to <strong>${esc(target.name)}</strong> (@${esc(target.profile.handle)}). <a href="#" onclick="state.offerTarget=null; loadMyOffers(); return false;">Make it an open offer instead</a></div>` : `<p class="small muted">Leave this open and any approved creator in ${esc(state.user.market)} can book it, or pick a creator in Discover and tap Send offer.</p>`}
      <div class="field"><label>Offer title</label><input id="o-title" required placeholder="For example: Dinner for two on us"></div>
      <div class="field"><label>Exactly what is comped</label><input id="o-comped" required placeholder="For example: Two entrees and two drinks for the creator and a guest"></div>
      <div class="form-2col">
        <div class="field"><label>Dollar cap ($)</label><input type="number" id="o-cap" min="1" required placeholder="75"></div>
        <div class="field"><label>Spots (creators who can book)</label><input type="number" id="o-spots" min="1" value="1" required></div>
      </div>
      <div class="field"><label>Visit window</label><input id="o-window" placeholder="For example: Any Tuesday to Thursday in October"></div>
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
    ${tabsHtml(["Applications", "Markets", "Event Log", "Stats"], tab)}
    <div id="tab-body"><p class="muted">Loading...</p></div>`;
  if (tab === "Applications") loadApplications();
  if (tab === "Markets") loadMarkets();
  if (tab === "Event Log") loadEvents();
  if (tab === "Stats") loadStats();
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
          <td><strong>${esc(m.name)}</strong><br><span class="muted small">${esc(m.label)}</span></td>
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
        ? `@${esc(u.creator.handle)} &middot; ${fmtNum(u.creator.followerCount)} followers &middot; ${esc(u.creator.tierBand)} &middot; Local: ${u.creator.localAudiencePct === null ? "not reported" : u.creator.localAudiencePct + "% (Self-reported)"} &middot; ${(u.creator.categories || []).map(esc).join(", ")} &middot; Photo: ${u.creator.hasPhoto ? "yes" : "no"} &middot; Socials: IG${u.creator.tiktokHandle ? ", TikTok" : ""}${u.creator.youtubeChannel ? ", YouTube" : ""}${u.creator.facebookUrl ? ", Facebook" : ""}${u.creator.xUrl ? ", X" : ""}${u.creator.linkedinUrl ? ", LinkedIn" : ""}`
        : u.role === "business" && u.business
          ? `${esc(u.business.businessName)} &middot; ${esc(u.business.category)} &middot; ${esc(u.business.planName)}`
          : "";
      return `<tr>
        <td><strong>${esc(u.name)}</strong><br><span class="muted small">${esc(u.email)}</span></td>
        <td>${esc(u.role)}${standing}</td><td>${esc(u.market)}<br><span class="muted small">${esc(u.city || "")}</span></td>
        <td class="small">${detail}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>${u.status === "pending"
          ? `<button class="btn small-btn" onclick="reviewApp('${u.id}','approve')">Approve</button> <button class="btn small-btn danger" onclick="reviewApp('${u.id}','reject')">Reject</button>`
          : `<span class="badge ${u.status === "approved" ? "ok" : "bad"}">${esc(u.status)}</span>`}</td>
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

async function reviewApp(userId, decision) {
  try {
    await api("POST", "/admin/review", { userId, decision });
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
        <div class="stat"><div class="num">${s.offers}</div><div class="lbl">Offers</div></div>
        <div class="stat"><div class="num">${s.bookings.redeemed}</div><div class="lbl">Visits redeemed</div></div>
        <div class="stat"><div class="num">${s.posts.total}</div><div class="lbl">Posts</div></div>
        <div class="stat"><div class="num">${s.posts.onTimeRate === null ? "n/a" : s.posts.onTimeRate + "%"}</div><div class="lbl">Posts on time</div></div>
      </div></div>
      <div class="table-wrap panel"><table>
        <tr><th>Market</th><th>Approved creators</th><th>Approved businesses</th><th>Bookings</th><th>Posts</th></tr>
        ${Object.entries(s.perMarket).map(([m, v]) => `<tr><td>${esc(m)}</td><td>${v.creators}</td><td>${v.businesses}</td><td>${v.bookings}</td><td>${v.posts}</td></tr>`).join("")}
      </table></div>`;
  } catch (err) {
    el.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
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
