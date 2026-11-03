// Sig's live-data brain (Build -69, Jeff 2026-11-01: "sig is
// really dumb... he needs to be super intelligent and answer
// alot... this is a driving function of this site").
//
// Before this build, Sig's only path to a number was the AI
// model, grounded in a handful of admin aggregates and the
// asker's own status lines. When no AI provider answered, the
// client fell back to the canon bank, which by design carries
// no counts at all, so a plain question like "how many total
// creators do i have" dead-ended at "I don't have that one yet"
// under a header promising "live Admin counts."
//
// This module is the fix, in three parts:
//   1. FACT BUILDERS: per-role fact sheets computed from the
//      same stored records (and the same helper functions) the
//      dashboards and the Command Center count from. Testers
//      stay out of roster counts, exactly like everywhere else.
//   2. GROUNDING LINES: the fact sheet as plain sentences, fed
//      to the language model so free-form answers use the real
//      numbers too. The sheet is the ONLY source of numbers.
//   3. THE ANSWERER: a deterministic interpreter for factual
//      questions. It runs BEFORE the model, needs no AI
//      provider at all, and answers number-first from the fact
//      sheet. It only speaks when the intent is clear; anything
//      else returns null and the model (or the canon bank)
//      takes the question.
//
// Voice rules for every answer built here: plain words, the
// number first, no em dashes, no markdown, no invented figures.
// A recorded figure is money the records show; a modeled
// figure is always labeled an estimate when Sig uses it.

const { currencyForMarket } = require("./markets");
function n0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
// Build -89: creator money renders in the creator's home-market
// currency (London: £). Business and admin facts keep $ — GBP
// business pricing is out of scope for this build.
function cmoney(f, n) { const v = n0(n); return ((f && f.currencySymbol) || "$") + (Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function fmt(n) { return Math.round(n0(n)).toLocaleString("en-US"); }
function money(n) { const v = n0(n); return "$" + (Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }
function dayLabel(iso, now) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const days = Math.max(0, Math.floor((now - t) / 86400000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
function nameOf(u) {
  if (!u) return "Someone";
  const biz = u.role === "business" && u.business && u.business.businessName ? u.business.businessName : null;
  return biz || u.name || (u.creator && u.creator.handle ? "@" + u.creator.handle : null) || u.email || "Someone";
}
function handleOf(u) { return u && u.creator && u.creator.handle ? "@" + u.creator.handle : ""; }
// Co-brand view (Build -105): mirrors router's brandViewOf.
// A brand counts as set when any of its fields carries content.
function brandViewOf(brand) {
  if (!brand || typeof brand !== "object") return null;
  const out = { displayName: brand.displayName || "", logoUrl: brand.logoUrl || null, accentColor: brand.accentColor || null, emailFromName: brand.emailFromName || "" };
  return (out.displayName || out.logoUrl || out.accentColor || out.emailFromName) ? out : null;
}

// ---------------- ADMIN FACTS ----------------
// deps: { users, offers, bookings, posts, partners, marketFlags,
//         marketNames, isTester, profileCompleteOf,
//         businessAccessState, planNameOf, now }
function buildAdminFacts(d) {
  const now = d.now || Date.now();
  const users = (d.users || []).filter((u) => u && u.role !== "admin");
  const creators = users.filter((u) => u.role === "creator");
  const realCreators = creators.filter((u) => !d.isTester(u));
  const businesses = users.filter((u) => u.role === "business");
  const realBusinesses = businesses.filter((u) => !d.isTester(u));

  const byStatus = (list) => {
    const out = { approved: 0, pending: 0, rejected: 0, other: 0 };
    for (const u of list) { if (out[u.status] !== undefined) out[u.status] += 1; else out.other += 1; }
    return out;
  };
  const cs = byStatus(realCreators);
  const bs = byStatus(realBusinesses);
  const approvedCreators = realCreators.filter((u) => u.status === "approved");
  const complete = approvedCreators.filter((u) => { try { return d.profileCompleteOf(u); } catch (e) { return false; } }).length;

  const marketMap = new Map();
  const mRow = (m) => {
    const key = m || "Not filed under a market";
    if (!marketMap.has(key)) marketMap.set(key, { market: key, creators: 0, approved: 0, pending: 0, complete: 0, businesses: 0, bizApproved: 0, bizActive: 0 });
    return marketMap.get(key);
  };
  for (const u of realCreators) {
    const r = mRow(u.market);
    r.creators += 1;
    if (u.status === "approved") { r.approved += 1; try { if (d.profileCompleteOf(u)) r.complete += 1; } catch (e) { /* counted above */ } }
    if (u.status === "pending") r.pending += 1;
  }
  const approvedBiz = realBusinesses.filter((u) => u.status === "approved");
  let founding = 0, active = 0;
  for (const u of approvedBiz) { if (d.businessAccessState(u) === "active") active += 1; else founding += 1; }
  for (const u of realBusinesses) {
    const r = mRow(u.market);
    r.businesses += 1;
    if (u.status === "approved") { r.bizApproved += 1; if (d.businessAccessState(u) === "active") r.bizActive += 1; }
  }
  const byMarket = [...marketMap.values()].sort((a, b) => b.creators - a.creators || b.businesses - a.businesses);

  const tierMap = new Map();
  for (const u of approvedCreators) {
    const t = (u.creator && u.creator.tierBand) || "No tier yet";
    tierMap.set(t, (tierMap.get(t) || 0) + 1);
  }
  const byTier = [...tierMap.entries()].map(([tier, count]) => ({ tier, count })).sort((a, b) => b.count - a.count);

  const planMap = new Map();
  for (const u of approvedBiz) {
    const p = d.planNameOf(u.business && (u.business.planId || u.business.plan));
    planMap.set(p, (planMap.get(p) || 0) + 1);
  }
  const byPlan = [...planMap.entries()].map(([plan, count]) => ({ plan, count })).sort((a, b) => b.count - a.count);

  const today = new Date(now).toISOString().slice(0, 10);
  const claimsToday = realCreators.filter((u) => String(u.createdAt || "").startsWith(today)).length;
  const signups7d = realCreators.filter((u) => { const t = Date.parse(u.createdAt || ""); return Number.isFinite(t) && now - t <= 7 * 86400000; }).length;
  const bizToday = realBusinesses.filter((u) => String(u.createdAt || "").startsWith(today)).length;

  const recentCreators = realCreators.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 5)
    .map((u) => ({ label: `${nameOf(u)}${handleOf(u) && nameOf(u) !== handleOf(u) ? " (" + handleOf(u) + ")" : ""}, ${u.market || "no market filed"}, ${u.status || "unknown"}`, when: dayLabel(u.createdAt, now) }));
  const recentBusinesses = realBusinesses.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))).slice(0, 5)
    .map((u) => ({ label: `${nameOf(u)}, ${u.market || "no market filed"}, ${u.status || "unknown"}`, when: dayLabel(u.createdAt, now) }));

  const pendingAll = users.filter((u) => u.status === "pending" && !d.isTester(u))
    .slice().sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const waiting = pendingAll.slice(0, 6).map((u) => ({
    label: `${nameOf(u)}, ${u.role === "business" ? "business" : "creator"}, ${u.market || "no market filed"}`,
    waited: dayLabel(u.createdAt, now) === "today" ? "since today" : `waiting ${dayLabel(u.createdAt, now).replace(" ago", "")}`,
  }));

  const offers = d.offers || [];
  const offerCounts = { total: offers.length, open: 0, draft: 0, filled: 0, closed: 0, expired: 0, other: 0 };
  const openByMarketMap = new Map();
  for (const o of offers) {
    if (offerCounts[o.status] !== undefined) offerCounts[o.status] += 1; else offerCounts.other += 1;
    if (o.status === "open") openByMarketMap.set(o.market || "Unknown market", (openByMarketMap.get(o.market || "Unknown market") || 0) + 1);
  }
  const openByMarket = [...openByMarketMap.entries()].map(([market, count]) => ({ market, count })).sort((a, b) => b.count - a.count);

  const bookings = d.bookings || [];
  const posts = d.posts || [];
  const postByBooking = new Set(posts.map((p) => p && p.bookingId));
  let completed = 0, upcoming = 0, awaitingPost = 0, overduePosts = 0;
  for (const b of bookings) {
    if (!b) continue;
    if (b.status === "completed") completed += 1;
    if (b.status === "cancelled" || b.status === "expired") continue;
    if (b.redeemedAt) {
      if (!postByBooking.has(b.id)) {
        if (b.postDeadline && now > Date.parse(b.postDeadline)) overduePosts += 1; else awaitingPost += 1;
      }
    } else if (b.status === "booked") upcoming += 1;
  }

  const partners = (d.partners || []).map((u) => ({
    name: (u.partner && u.partner.name) || u.name || "Partner",
    status: (u.partner && u.partner.status) || "active",
    markets: (u.partner && u.partner.markets) || [],
    demo: !!(u.partner && u.partner.demo),
    // Co-brand (Build -105): whether Admin has set a brand
    // block for this partner, and whether a logo is on file.
    brandSet: !!brandViewOf(u.partner && u.partner.brand),
    brandName: (brandViewOf(u.partner && u.partner.brand) || {}).displayName || "",
    hasLogo: !!(brandViewOf(u.partner && u.partner.brand) || {}).logoUrl,
  }));
  const flags = d.marketFlags || {};
  const liveNames = Object.keys(flags).filter((k) => flags[k]);

  return {
    role: "admin",
    creators: {
      total: realCreators.length, records: creators.length, testers: creators.length - realCreators.length,
      approved: cs.approved, pending: cs.pending, rejected: cs.rejected, other: cs.other,
      complete, approvedIncomplete: cs.approved - complete,
      byMarket, byTier, claimsToday, signups7d, recent: recentCreators,
    },
    businesses: {
      total: realBusinesses.length, records: businesses.length, testers: businesses.length - realBusinesses.length,
      approved: bs.approved, pending: bs.pending, rejected: bs.rejected, other: bs.other,
      founding, active, byPlan, signupsToday: bizToday, recent: recentBusinesses,
      // Which till (Build -101): the declared-POS mix over the
      // same real-business set as every count above.
      posMix: (() => {
        const counts = { square: 0, clover: 0, toast: 0, lightspeed: 0, other: 0, none: 0, undeclared: 0 };
        for (const u of realBusinesses) {
          const p = u.business && typeof u.business.posProvider === "string" ? u.business.posProvider : null;
          if (p && counts[p] !== undefined) counts[p] += 1; else counts.undeclared += 1;
        }
        return counts;
      })(),
    },
    waiting: { total: pendingAll.length, creators: cs.pending, businesses: bs.pending, list: waiting },
    offers: { ...offerCounts, openByMarket },
    visits: { bookings: bookings.length, completed, upcoming, awaitingPost, overduePosts, postsLive: posts.length },
    partners: { total: partners.length, active: partners.filter((p) => p.status === "active").length, paused: partners.filter((p) => p.status === "paused").length, list: partners },
    // Build -103: deal records as entered (currency + split),
    // so money answers stay per-currency and a missing London
    // split is said plainly instead of assumed.
    deals: Array.isArray(d.dealFacts) ? d.dealFacts : [],
    // Build -104: territory conflicts (records inside a
    // market-wide territory stamped elsewhere or nowhere).
    territoryConflicts: Array.isArray(d.territoryConflicts) ? d.territoryConflicts : [],
    markets: { liveNames, liveCount: liveNames.length, known: (d.marketNames || []).length },
  };
}

// ---------------- BUSINESS FACTS ----------------
// deps: { user, readout, applicantsWaiting, rosterInMarket,
//         marketLive, plan }
function buildBusinessFacts(d) {
  const u = d.user || {};
  const o = (d.readout && d.readout.overall) || {};
  const pv = o.planVisits || {};
  const lic = o.licenseRequests || {};
  return {
    role: "business",
    businessName: (u.business && u.business.businessName) || u.name || "your business",
    market: u.market || null,
    marketLive: !!d.marketLive,
    founding: d.founding != null ? !!d.founding : !d.marketLive,
    accessState: (u.business && u.business.accessState) || "founding",
    planName: (d.plan && d.plan.name) || null,
    planPrice: d.plan ? d.plan.priceMonthly : null,
    visitsPerMonth: d.plan ? d.plan.visitsPerMonth : null,
    foundingCredit: d.plan && typeof d.plan.foundingCredit === "number" ? d.plan.foundingCredit : 100,
    visitsUsed: pv.used != null ? pv.used : (o.visitsUsed || 0),
    visitsAllowance: pv.allowance != null ? pv.allowance : 0,
    visitsRemaining: pv.remaining != null ? pv.remaining : 0,
    visitsCarried: pv.carried || 0,
    offersLive: o.offersLive || 0,
    draftOffers: d.draftOffers || 0,
    // Build -97 proactive prompts: total campaign records,
    // drafts an active business started and never sent, and
    // plan visits unused partway through the month (computed
    // in the router, where the date and founding state live).
    offersTotal: d.offersTotal || 0,
    unfinishedDrafts: d.unfinishedDrafts || 0,
    visitsUnusedMidMonth: d.visitsUnusedMidMonth || null,
    applicantsWaiting: d.applicantsWaiting || 0,
    visitsBooked: o.visitsBooked || 0,
    visitsRedeemed: o.visitsRedeemed || 0,
    postsLive: o.postsLive || 0,
    // Intent (Build -83): recorded shares + saves on the posts
    // this business received, from the readout's intent block.
    intentViews: o.intent ? o.intent.views || 0 : 0,
    intentShares: o.intent ? o.intent.shares || 0 : 0,
    intentSaves: o.intent ? o.intent.saves || 0 : 0,
    intentTotal: o.intent ? o.intent.intent || 0 : 0,
    intentReportedPosts: o.intent ? o.intent.reportedPosts || 0 : 0,
    returnScore: o.returnScore ? o.returnScore.score : null,
    countedCustomers: o.redemptions ? o.redemptions.count || 0 : 0,
    countedDollars: o.registerValue || 0,
    modeledDollars: o.estimatedRegisterValue || 0,
    licensesGranted: lic.granted || 0,
    licensesPending: lic.pending || 0,
    rosterInMarket: d.rosterInMarket || 0,
    // Build -95: My Regulars (creators with a completed visit
    // at this business) and held licences inside their 14-day
    // expiry window, from the same builders the views read.
    regulars: (d.regulars || []).map((r) => ({
      creatorId: r.creatorId, name: r.creatorName || "", handle: r.creatorHandle || "",
      visits: r.visits || 1, dealKind: r.deal ? r.deal.kind : "comp",
      lastVisitAt: r.lastVisitAt || null, rebookedSince: !!r.rebookedSince,
    })),
    regularsCount: (d.regulars || []).length,
    licencesExpiring: (d.licencesExpiring || []).map((l) => ({
      postId: l.postId, creatorName: l.creatorName || "", creatorHandle: l.creatorHandle || "",
      title: l.title || "", kind: l.kind || "licensed", fee: l.fee != null ? l.fee : null,
      endsOn: l.windowEndsAt ? String(l.windowEndsAt).slice(0, 10) : "", daysLeft: l.daysLeft, ended: !!l.ended,
    })),
    // Build -96: standing availability from the business page
    // record, and last month's receipt-ready state (real
    // activity only, computed in the router).
    availabilitySet: !!(d.availability && d.availability.summary),
    availabilitySummary: d.availability && d.availability.summary ? d.availability.summary : null,
    receiptReady: d.receiptReady || null,
    // Build -99: the ONE setup checklist (the same builder
    // Home renders): what is left to set up, item by item,
    // and the register's state inside it.
    setup: d.setupChecklist ? {
      remaining: (d.setupChecklist.items || []).filter((i) => !i.done).map((i) => ({ id: i.id, label: i.label })),
      doneCount: d.setupChecklist.doneCount || 0,
      total: d.setupChecklist.total || 0,
      allDone: !!d.setupChecklist.allDone,
      square: d.setupChecklist.register ? { configured: !!d.setupChecklist.register.configured, state: d.setupChecklist.register.state } : null,
      // Which till (Build -101): the business's own declared
      // register system from the same checklist payload.
      pos: d.setupChecklist.pos || null,
    } : null,
  };
}

// ---------------- CREATOR FACTS ----------------
// deps: { user, full, readout, bookings, posts, openOffers,
//         directInvites, level, listedMarkets, missingLabels }
function buildCreatorFacts(d) {
  const u = d.user || {};
  const c = u.creator || {};
  const mom = (d.full && d.full.momentum) || {};
  const o = (d.readout && d.readout.overall) || {};
  const ledger = (mom.ledger || []).slice()
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 3)
    .map((e) => ({ label: e.label, points: e.points }));
  const now = Date.now();
  const postByBooking = new Set((d.posts || []).map((p) => p && p.bookingId));
  const owed = [];
  let upcoming = 0;
  for (const b of d.bookings || []) {
    if (!b || b.status === "cancelled" || b.status === "expired") continue;
    if (b.redeemedAt && !postByBooking.has(b.id)) owed.push({ title: b.title || "a visit", businessName: b.businessName || "a business", overdue: !!(b.postDeadline && now > Date.parse(b.postDeadline)) });
    else if (!b.redeemedAt && b.status === "booked") upcoming += 1;
  }
  const pc = (d.full && d.full.profileCompletion) || {};
  return {
    role: "creator",
    handle: c.handle || null,
    market: u.market || null,
    marketLive: !!d.marketLive,
    status: u.status || null,
    momentumPoints: mom.points || 0,
    level: d.level || null,
    recentLedger: ledger,
    referrals: { signups: mom.signups || 0, approved: mom.approved || 0 },
    tier: c.tierBand || null,
    audienceTotal: d.audienceTotal != null ? d.audienceTotal : null,
    localPct: c.localAudiencePct != null ? c.localAudiencePct : null,
    listedMarkets: d.listedMarkets || [],
    // Build -102: the public roster pages this creator appears
    // on, from the same finished-public predicate the pages and
    // the sitemap use (rides the withFounding payload).
    publicRoster: (d.full && d.full.publicRoster) || [],
    profileComplete: !!pc.complete,
    missingLabels: d.missingLabels || [],
    offersOpen: d.openOffers || 0,
    directInvites: d.directInvites || 0,
    applicationsPending: o.applicationsPending || 0,
    visitsBooked: o.visitsBooked || 0,
    visitsUpcoming: upcoming,
    postsOwed: owed,
    visitsRedeemed: o.visitsRedeemed || 0,
    postsLive: o.postsLive || 0,
    // Intent (Build -83): the creator's own recorded shares and
    // saves across their reported posts.
    intentViews: o.intent ? o.intent.views || 0 : 0,
    intentShares: o.intent ? o.intent.shares || 0 : 0,
    intentSaves: o.intent ? o.intent.saves || 0 : 0,
    intentTotal: o.intent ? o.intent.intent || 0 : 0,
    intentReportedPosts: o.intent ? o.intent.reportedPosts || 0 : 0,
    onTimePct: o.onTimePct != null ? o.onTimePct : null,
    paidBookings: o.paidBookings || 0,
    paidRecordedNet: o.paidRecordedNet || 0,
    licenseRequestsPending: o.licenseRequestsPending || 0,
    // Build -95: the actual pending licence/renewal requests
    // behind that count (business + fee + renewal flag).
    pendingLicenses: (d.pendingLicenses || []).map((l) => ({ businessName: l.businessName || "A business", fee: l.fee || 0, renewal: !!l.renewal })),
    // Build -96: standing availability of the businesses this
    // creator can meet (open offers, direct invites, own
    // bookings), only where the business set it.
    businessAvailability: (d.businessAvailability || []).map((b) => ({ businessId: b.businessId, businessName: b.businessName || "A business", summary: b.summary || "" })),
    paidRate: c.paidRate || null,
    licenseFee: c.licensingFee || c.licenseFee || null,
    currencySymbol: currencyForMarket(u.market).symbol,
    currencyCode: currencyForMarket(u.market).code,
    paidFloor: currencyForMarket(u.market).paidFloor,
    // Build -98 (11g/11h): the rate-card starting defaults for
    // this creator's tier (a form pre-fill for blank fields
    // only, never a stored rate and never a mandate), and the
    // creator's own payout-setup state, so Sig answers and the
    // proactive prompts read the same record as the screens.
    rateStarting: rateStartingFor(c.tierBand, d.audienceTotal, currencyForMarket(u.market).paidFloor),
    payoutsStatus: (c.payouts && c.payouts.status) || "not_started",
    payoutsReady: !!ucPayoutsReady(c),
  };
}
function ucPayoutsReady(c) { return c && c.payouts && c.payouts.ready; }
// Build -98 (11g): starting defaults by tier band. The numbers
// are the middle rates of the demo showcase roster in the
// codebase (Neighbors 120 paid / 80 licensing, Locals 225 /
// 150, Headliners 425 / 280), floored at the market paid floor.
const RATE_STARTING_98 = {
  Neighbors: { paidRate: 120, licensingFee: 80 },
  Locals: { paidRate: 225, licensingFee: 150 },
  Headliners: { paidRate: 425, licensingFee: 280 },
};
function rateStartingFor(tierBand, audienceTotal, paidFloor) {
  let tier = RATE_STARTING_98[tierBand] ? tierBand : null;
  if (!tier) {
    const n = n0(audienceTotal);
    tier = n >= 15000 ? "Headliners" : n >= 2000 ? "Locals" : "Neighbors";
  }
  const d = RATE_STARTING_98[tier];
  return { tier, paidRate: Math.max(d.paidRate, n0(paidFloor) || 0), licensingFee: d.licensingFee };
}

// ---------------- GROUNDING LINES ----------------
// The fact sheet as plain sentences for the language model.
// This is the model's only source of numbers.
function factsLines(role, f) {
  if (!f) return [];
  if (role === "admin") {
    const c = f.creators, b = f.businesses;
    const lines = [];
    lines.push(`Live platform counts right now, computed from the same records Admin shows (tester and demo records are excluded from every roster count): ${fmt(c.total)} ${plural(c.total, "creator")} in total: ${fmt(c.approved)} approved, ${fmt(c.pending)} pending, ${fmt(c.rejected)} rejected. Of the approved creators, ${fmt(c.complete)} have finished profiles, and finished profiles are the roster businesses can see; ${fmt(c.approvedIncomplete)} approved creators have not finished yet.`);
    if (c.byMarket.length) lines.push(`Creators by market (total / approved / finished): ${c.byMarket.slice(0, 8).map((m) => `${m.market} ${m.creators}/${m.approved}/${m.complete}`).join("; ")}${c.byMarket.length > 8 ? `; plus ${c.byMarket.length - 8} more markets` : ""}.`);
    if (c.byTier.length) lines.push(`Approved creators by tier: ${c.byTier.map((t) => `${t.tier} ${t.count}`).join(", ")}.`);
    lines.push(`Businesses: ${fmt(b.total)} in total: ${fmt(b.approved)} approved (${fmt(b.active)} active, ${fmt(b.founding)} on the founding list waiting for activation), ${fmt(b.pending)} pending. Businesses by plan: ${b.byPlan.length ? b.byPlan.map((p) => `${p.plan} ${p.count}`).join(", ") : "none yet"}. Creator sign-ups: ${fmt(c.claimsToday)} today, ${fmt(c.signups7d)} in the last 7 days.`);
    lines.push(`Offers: ${fmt(f.offers.total)} in total: ${fmt(f.offers.open)} open, ${fmt(f.offers.draft)} drafts, ${fmt(f.offers.filled)} filled, ${fmt(f.offers.closed)} closed. Visits: ${fmt(f.visits.bookings)} bookings, ${fmt(f.visits.completed)} completed, ${fmt(f.visits.upcoming)} booked and coming up, ${fmt(f.visits.postsLive)} posts live, ${fmt(f.visits.awaitingPost)} visits waiting on a post, ${fmt(f.visits.overduePosts)} posts overdue (that overdue count is the compliance queue).`);
    lines.push(`Partners: ${fmt(f.partners.total)} (${fmt(f.partners.active)} active, ${fmt(f.partners.paused)} paused)${f.partners.list.length ? ": " + f.partners.list.map((p) => `${p.name} (${p.status}${p.markets.length ? ", " + p.markets.join(" + ") : ""}${p.brandSet ? `, co-branded${p.brandName ? ` as ${p.brandName}` : ""}${p.hasLogo ? ", logo on file" : ", no logo on file"}` : ", no co-brand set"})`).join("; ") : ""}. Markets live: ${f.markets.liveCount ? f.markets.liveNames.join(", ") : "none yet"}. Applications waiting on a decision: ${fmt(f.waiting.total)} (${fmt(f.waiting.creators)} ${plural(f.waiting.creators, "creator")}, ${fmt(f.waiting.businesses)} ${plural(f.waiting.businesses, "business", "businesses")}).`);
    if ((f.deals || []).length) lines.push(`Deals on file: ${f.deals.map((x) => `${x.label} (${x.partnerName || "partner"}, ${x.status}) in ${x.currency}: ${x.partnerPct === null ? "no split entered yet" : `partner split ${x.partnerPct}% as entered`}`).join("; ")}. London founding prices live in the GBP book: £149 / £269 / £549 a month plus VAT, £75 founding credit; a split exists only where a deal record says so.`);
    const held = (f.deals || []).filter((x) => (x.status === "signed" || x.status === "live") && (x.liveMarkets || []).length);
    if (held.length) lines.push(`Territory held: ${held.map((x) => `${(x.liveMarkets || []).join(", ")} — ${x.partnerName || "partner"} (${x.label}), ${x.attributionScope === "sourced_only" ? "only businesses the partner brought in count" : "the whole market counts"}, exclusivity ${x.exclusivity === "market_conditional" ? "conditional" : "none"}`).join("; ")}.`);
    if ((f.territoryConflicts || []).length) lines.push(`Territory conflicts: ${f.territoryConflicts.length} ${f.territoryConflicts.length === 1 ? "record sits" : "records sit"} in a market-wide territory stamped to a different partner or to none: ${f.territoryConflicts.slice(0, 6).map((c) => `${c.name} (${c.market})`).join("; ")}.`);
    lines.push("This admin surface is read-only for you: answer and explain, and point to the Admin tab where an action lives. Never claim you approved, sent, activated, or changed anything.");
    return lines;
  }
  if (role === "business") {
    const lines = [];
    lines.push(`Their business is ${f.businessName} in ${f.market || "an unfiled market"}. The market is ${f.marketLive ? "OPEN (live)" : "NOT open yet, so the business is on the founding list and nothing is charged"}.`);
    if (f.planName) lines.push(`Their plan is ${f.planName} at ${money(f.planPrice)} a month with ${f.visitsPerMonth} creator visits a month and a ${money(f.foundingCredit)} founding credit off the first month. This month they have used ${fmt(f.visitsUsed)} of ${fmt(f.visitsAllowance)} visits (${fmt(f.visitsRemaining)} left${f.visitsCarried ? `, including ${fmt(f.visitsCarried)} rolled over from last month` : ""}).`);
    lines.push(`Their numbers right now: ${fmt(f.offersLive)} offers live, ${fmt(f.draftOffers)} drafts, ${fmt(f.applicantsWaiting)} applicants waiting on their answer, ${fmt(f.visitsBooked)} visits booked, ${fmt(f.postsLive)} posts live. Counted register dollars so far: ${money(f.countedDollars)} (counted means rung up through visit codes). Modeled estimate on top of that: ${money(f.modeledDollars)}, and that figure is an estimate, never a counted sale. Creators with finished profiles in their market: ${fmt(f.rosterInMarket)}.`);
    if (f.intentTotal > 0) lines.push(`Post intent on their live posts: ${fmt(f.intentShares)} shares and ${fmt(f.intentSaves)} saves recorded by the creators, ${fmt(f.intentTotal)} in total across ${fmt(f.intentReportedPosts)} reported ${plural(f.intentReportedPosts, "post")}. Saves and shares mean people planning to come. These are recorded figures, not counted sales. Their Return score across those posts is ${f.returnScore != null ? fmt(f.returnScore) + " out of 100" : "not scored yet (not enough data)"}.`);
    if (f.regularsCount) lines.push(`Their Regulars (creators who completed a visit and posted): ${f.regulars.map((r) => `${r.name}${r.handle ? " (@" + r.handle + ")" : ""}, ${fmt(r.visits)} ${plural(r.visits, "visit")}, last visit ${r.lastVisitAt ? String(r.lastVisitAt).slice(0, 10) : "on record"}${r.rebookedSince ? ", already rebooked since" : ""}`).join("; ")}. Regulars live in the Regulars view, where Book again clones the last visit's deal into a new draft.`);
    if (f.licencesExpiring && f.licencesExpiring.length) lines.push(`Licences ending soon: ${f.licencesExpiring.map((l) => `${l.creatorName || "a creator"}'s post "${l.title}" ends ${l.endsOn} (${l.ended ? "already ended" : fmt(Math.max(0, l.daysLeft)) + " days left"})`).join("; ")}. Renewing goes through the creator: a fresh request at their listed fee for 90 days, approved by them, never automatic.`);
    lines.push(f.availabilitySet
      ? `Their standing availability, set once on their business page and shown to creators on their offers: ${f.availabilitySummary}. It pre-fills the timing on new offers; a per-offer note still wins for that offer.`
      : "They have not set standing availability yet: the usual open days and hours creators see, set once on the business page. Until it is set, every offer carries its own timing note.");
    if (f.receiptReady) lines.push(`${f.receiptReady.monthLabel}'s receipt is ready to forward: that month ended with real activity. The forwardable monthly receipt export lives in Results: counted, recorded, and intent figures in three separate sections, visits used and rolled over, founding credit state, and licence end dates.`);
    if (f.setup) lines.push(f.setup.allDone
      ? `Their setup checklist on Home is fully done, all ${fmt(f.setup.total)} items, so the checklist has retired and Home shows nothing for it.`
      : `Their setup checklist on Home (titled Get the most from SIGNL) has ${fmt(f.setup.doneCount)} of ${fmt(f.setup.total)} items done. Still to do: ${f.setup.remaining.map((i) => i.label).join("; ")}. The Square register connects from that checklist on Home, not from Results: Results keeps the register status and the counted numbers, and the connect button lives on the checklist.${f.setup.square && f.setup.square.state === "paused" ? " Their register is PAUSED right now: reconnecting also lives with the connection, in Results under Proof controls, and on the checklist." : ""}${f.setup.square && !f.setup.square.configured ? " Square is not switched on for this account yet: connecting happens on the setup call, and the checklist item says so." : ""}`);
    if (f.setup) lines.push(f.setup.pos
      ? `The till they told us they run: ${f.setup.pos.label}${f.setup.pos.other ? ` (${f.setup.pos.other})` : ""}. Visit codes count at any till today. ${f.setup.pos.provider === "square" ? "Square is the register SIGNL can connect directly today." : f.setup.pos.provider === "none" ? "They run no register system; codes are counted by hand at the counter with the staff PIN." : `A direct ${f.setup.pos.label} connection is on the roadmap once enough businesses declare it; no date is promised, and their codes already count at the till in the meantime.`}`
      : "They have not told us which till (register system) they run yet. It is one tap on the setup checklist on Home or on their business page, and it only changes how visits get counted later; codes count at every till today.");
    return lines;
  }
  // creator
  const lines = [];
  const lv = f.level;
  lines.push(`Their market is ${f.market || "unknown"} and it is ${f.marketLive ? "OPEN (live)" : "NOT open yet (founding)"}. Their application status is ${f.status || "unknown"}. Their profile is ${f.profileComplete ? "finished, so businesses can see them" : "NOT finished yet; still missing: " + (f.missingLabels.join(", ") || "nothing recorded") + ". A finished profile is the gate for being seen by businesses."}`);
  lines.push(f.publicRoster && f.publicRoster.length
    ? `Public roster pages they appear on right now: ${f.publicRoster.map((r) => `${r.market} (${r.url})`).join(", ")}. A market's public roster page opens only when at least 5 finished public profiles are listed there; these are public web pages, separate from the in-app roster businesses browse.`
    : "They are not on a public roster page yet: a market's public roster opens once at least 5 finished public profiles are listed in it. Businesses inside SIGNL can still find a finished profile in the app; the public page is the web version of the same roster.");
  lines.push(`Their Momentum is ${fmt(f.momentumPoints)} points, level ${lv ? lv.name : "Starter"}${lv && lv.nextName ? `, with ${fmt(lv.nextAt - f.momentumPoints)} points to ${lv.nextName}` : ", the top level"}. Their tier is ${f.tier || "not set yet"}${f.audienceTotal != null ? ` on ${fmt(f.audienceTotal)} total followers across platforms` : ""}. Local audience in their home market: ${f.localPct != null ? f.localPct + "%" : "not reported"}. Markets they are listed in: ${f.listedMarkets.length ? f.listedMarkets.map((m) => `${m.market}${m.pct != null ? " (" + m.pct + "% local)" : ""}`).join(", ") : "just their home market"}.`);
  lines.push(`Their numbers right now: ${fmt(f.offersOpen)} open offers in their markets (${fmt(f.directInvites)} direct invites), ${fmt(f.applicationsPending)} applications waiting on a business's answer, ${fmt(f.visitsBooked)} visits booked, ${fmt(f.postsOwed.length)} posts owed, ${fmt(f.postsLive)} posts live${f.onTimePct != null ? `, ${f.onTimePct}% of their posts on time` : ""}. Paid bookings: ${fmt(f.paidBookings)}, with ${cmoney(f, f.paidRecordedNet)} recorded as their net (recorded means the bookings on file, paid outside the app). License requests waiting on them: ${fmt(f.licenseRequestsPending)}. Creators joined through their invite link: ${fmt(f.referrals.signups)}, of whom ${fmt(f.referrals.approved)} were approved.`);
  if (f.intentTotal > 0) lines.push(`Intent on their own posts: ${fmt(f.intentShares)} shares and ${fmt(f.intentSaves)} saves recorded, ${fmt(f.intentTotal)} in total across ${fmt(f.intentReportedPosts)} reported ${plural(f.intentReportedPosts, "post")}. Saves and shares mean people planning to come.`);
  if (f.paidRate) lines.push(`Their listed paid rate is ${cmoney(f, f.paidRate)}${f.licenseFee ? ` and their licensing fee is ${cmoney(f, f.licenseFee)}` : ""}.`);
  else if (f.rateStarting) lines.push(`They have not set a paid rate yet. The Profile rate boxes pre-fill a starting point for their ${f.rateStarting.tier} tier: paid rate ${cmoney(f, f.rateStarting.paidRate)} and licensing fee ${cmoney(f, f.rateStarting.licensingFee)}. Those are starting points only, filled in because the fields were blank. They are editable, they are not a price the creator has to use, and nothing is stored until the creator saves.`);
  if (!f.payoutsReady && (f.paidBookings > 0 || f.paidRecordedNet > 0)) lines.push(`Their payouts are not set up yet (status: ${f.payoutsStatus || "not_started"}), and they have paid bookings or recorded earnings on file. Payout setup lives on their Profile, in the paid lane. Before the first setup, an explainer on that surface says what Stripe will ask for and why: identity details, address, bank account, and tax information. Paid bookings are recorded in the app and settled with help until the payout rail fully opens; no payout date is promised.`);
  lines.push("Creator terms in plain words live at https://joinsignl.com/creator-terms.html. When a creator asks about terms, that link goes with the answer.");
  if (f.pendingLicenses && f.pendingLicenses.length) lines.push(`Licence requests waiting on their decision: ${f.pendingLicenses.map((l) => `${l.businessName} at their ${cmoney(f, l.fee)} fee${l.renewal ? " (a renewal of a licence that is ending)" : ""}`).join("; ")}. Each is decided under Earnings: approve starts a fresh 90 days that day; decline leaves the post native share only.`);
  if (f.businessAvailability && f.businessAvailability.length) lines.push(`Standing availability at businesses they can book with: ${f.businessAvailability.map((b) => `${b.businessName}: ${b.summary}`).join("; ")}. A business that is not listed here has not set its hours; the offer's own window and note are what applies.`);
  return lines;
}

// ---------------- THE ANSWERER ----------------
// Deterministic answers to factual questions, built only from
// the fact sheet. Returns a plain-text answer, a linked answer
// ({ text, link }, Build -81), or null. Null
// means "not a data question I am sure about": the language
// model (grounded in these same facts) or the canon bank
// answers instead. Canon questions ("how does licensing
// work") deliberately return null unless they ask for the
// asker's own number ("my licensing fee").
function normQ(q) {
  return " " + String(q || "").toLowerCase().replace(/can't/g, "cant").replace(/don't/g, "dont").replace(/[^a-z0-9%$ ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}
function hasWord(t, ...words) { return words.some((w) => t.includes(" " + w + " ") || t.includes(" " + w)); }
function hasPhrase(t, ...phrases) { return phrases.some((p) => t.includes(p)); }

function findMarketIn(qRaw, names) {
  const q = " " + String(qRaw || "").toLowerCase() + " ";
  if (q.includes(" hampton roads ")) { const vb = names.find((n) => n.toLowerCase() === "virginia beach"); if (vb) return vb; }
  const sorted = names.slice().sort((a, b) => b.length - a.length);
  for (const n of sorted) { if (n && (q.includes(" " + n.toLowerCase() + " ") || q.includes(" " + n.toLowerCase() + "?"))) return n; }
  return null;
}
function marketRow(f, market) {
  if (!market) return null;
  return f.creators.byMarket.find((m) => m.market.toLowerCase() === market.toLowerCase()) || null;
}
function marketLive(f, market) {
  return (f.markets.liveNames || []).some((n) => n.toLowerCase() === String(market || "").toLowerCase());
}

// Build -81: an answer that SHOWS records (a queue, a list of
// names, a digest of the asker's own numbers) carries the walk
// to the surface that holds them: { text, link: { label, dest } },
// where dest is a key the client maps to real navigation.
// Plain factual answers (a bare count, a price, a rule) stay
// plain strings and get no link: no fake links. Admin dests
// point only at the console's own record tabs (Applications,
// Partners, Compliance), so console Sig stays read-only in
// spirit: the button walks the owner, it never edits a record.
function linked(text, label, dest) { return { text, link: { label, dest } }; }

// ---------- ADMIN ----------
function answerAdmin(f, q, t) {
  const c = f.creators, b = f.businesses;
  const marketNames = [...new Set([...c.byMarket.map((m) => m.market), ...f.markets.liveNames])];
  const market = findMarketIn(q, marketNames);
  const row = marketRow(f, market);
  const countAsk = hasPhrase(t, "how many", "total", "count", "number of", "do we have", "do i have", "have we got", "how much of");

  // What needs attention
  if (hasPhrase(t, "needs my attention", "need my attention", "needs attention", "waiting on me", "whats waiting", "what is waiting", "to decide", "on my plate")) {
    const bits = [];
    if (f.waiting.total) bits.push(`${fmt(f.waiting.total)} ${plural(f.waiting.total, "application")} waiting on a decision (${fmt(f.waiting.creators)} ${plural(f.waiting.creators, "creator")}, ${fmt(f.waiting.businesses)} ${plural(f.waiting.businesses, "business", "businesses")})`);
    if (b.founding) bits.push(`${fmt(b.founding)} approved ${plural(b.founding, "business", "businesses")} on the founding list waiting for activation`);
    if (f.visits.overduePosts) bits.push(`${fmt(f.visits.overduePosts)} ${plural(f.visits.overduePosts, "post")} overdue in the compliance queue`);
    if (f.partners.paused) bits.push(`${fmt(f.partners.paused)} ${plural(f.partners.paused, "partner")} paused`);
    if (!bits.length) return linked("Nothing is waiting on you right now. Applications are decided, no posts are overdue, no businesses are held at activation, and partners are in order.", "Open the Review queue", "admin-applications");
    return linked(`Here is what needs you: ${bits.join("; ")}. The Review queue under Applications holds the decisions; this chat stays read-only.`, "Open the Review queue", "admin-applications");
  }

  // Waiting list, with names
  if ((hasWord(t, "pending", "waiting", "queue") || hasPhrase(t, "applications")) &&
      hasPhrase(t, "who", "show", "list", "names", "oldest", "waiting on")) {
    if (!f.waiting.total) return "Nobody is waiting. Every application on file has a decision.";
    const names = f.waiting.list.map((w) => `${w.label} (${w.waited})`).join("; ");
    const more = f.waiting.total > f.waiting.list.length ? `, and ${fmt(f.waiting.total - f.waiting.list.length)} more` : "";
    return linked(`${fmt(f.waiting.total)} ${plural(f.waiting.total, "application")} waiting on a decision (${fmt(f.waiting.creators)} ${plural(f.waiting.creators, "creator")}, ${fmt(f.waiting.businesses)} ${plural(f.waiting.businesses, "business", "businesses")}). Oldest first: ${names}${more}. They are decided in the Review queue under Applications.`, "Open the Review queue", "admin-applications");
  }

  // Recent sign-ups
  if (hasPhrase(t, "recent", "latest", "newest", "just signed", "signed up today", "signups today", "sign-ups today", "joined today") ||
      (hasWord(t, "who") && hasPhrase(t, "signed up", "sign up", "joined"))) {
    if (hasWord(t, "business", "businesses")) {
      if (!b.recent.length) return "No business sign-ups on file yet.";
      return linked(`${fmt(b.signupsToday)} business ${plural(b.signupsToday, "sign-up")} today. The newest: ${b.recent.map((r) => `${r.label} (${r.when})`).join("; ")}.`, "Open Applications", "admin-applications");
    }
    if (!c.recent.length) return "No creator sign-ups on file yet.";
    return linked(`${fmt(c.claimsToday)} creator ${plural(c.claimsToday, "sign-up")} today, ${fmt(c.signups7d)} in the last 7 days. The newest: ${c.recent.map((r) => `${r.label} (${r.when})`).join("; ")}.`, "Open Applications", "admin-applications");
  }
  if ((hasWord(t, "signups", "sign-ups", "claims", "joined") || hasPhrase(t, "signed up")) && (hasWord(t, "today") || hasPhrase(t, "this week", "last 7 days", "past week"))) {
    if (hasWord(t, "today")) return `${fmt(c.claimsToday)} creator ${plural(c.claimsToday, "sign-up")} today (${fmt(b.signupsToday)} ${plural(b.signupsToday, "business", "businesses")}).`;
    return `${fmt(c.signups7d)} creator ${plural(c.signups7d, "sign-up")} in the last 7 days.`;
  }

  // Which till (Build -101): the declared-POS mix Admin watches
  // for the Clover trigger, tester records excluded as always.
  if (hasPhrase(t, "which till", "what till", "tills", "pos mix", "register systems", "point of sale", "what pos", "clover", "toast", "lightspeed") || (hasWord(t, "pos") && countAsk)) {
    const m = b.posMix || {};
    const declared = (m.square || 0) + (m.clover || 0) + (m.toast || 0) + (m.lightspeed || 0) + (m.other || 0) + (m.none || 0);
    return linked(`Declared tills across ${fmt(b.total)} real ${plural(b.total, "business", "businesses")}: Square ${fmt(m.square || 0)}, Clover ${fmt(m.clover || 0)}, Toast ${fmt(m.toast || 0)}, Lightspeed ${fmt(m.lightspeed || 0)}, another system ${fmt(m.other || 0)}, no register system ${fmt(m.none || 0)}, and ${fmt(m.undeclared || 0)} have not declared yet. ${declared} ${plural(declared, "declaration")} on file; the Clover build trigger is 10 to 20 declared businesses. The mix strip sits on the Command Center Businesses view.`, "Open Businesses", "admin-businesses");
  }

  // London money (Build -103): GBP answers come from the GBP
  // deal records and the GBP price book only — never blended
  // with dollars, and a split is reported only as entered.
  if (hasWord(t, "london", "gbp", "pound", "pounds") || t.includes("£")) {
    const gbpDeals = (f.deals || []).filter((x) => x.currency === "GBP");
    if (hasWord(t, "split", "share", "deal", "partner")) {
      if (!gbpDeals.length) return "No London (GBP) deal is on file yet, so there is no London split to report. A split is set per deal when one is signed; nothing is assumed by default. London founding prices live in the GBP book: £149 / £269 / £549 a month plus VAT, with a £75 founding credit.";
      return gbpDeals.map((x) => `${x.label} (${x.partnerName || "partner"}, ${x.status}): ${x.partnerPct === null ? "no split entered yet — nothing accrues until one is" : `partner split ${x.partnerPct}% as entered`}.`).join(" ") + " Pounds and dollars are always reported on separate lines, never added together.";
    }
    return "London prices live in the GBP book: Self-Service £149, Growth £269, Managed £549 a month, all plus VAT, with a £75 founding credit (first months £74 / £194 / £474) and a 3-month minimum. London is sold through the UK launch partner, so those amounts are recorded, never charged through SIGNL checkout.";
  }

  // Territory (Build -104): who holds a market, whether it
  // is exclusive, and which records conflict — all read from
  // the deal records the resolver enforces.
  if (hasPhrase(t, "territory conflict", "territory conflicts") || (hasWord(t, "conflict", "conflicts", "conflicting") && hasWord(t, "territory", "stamp", "stamped", "attribution"))) {
    const list = f.territoryConflicts || [];
    if (!list.length) return "No territory conflicts: every record inside a market-wide territory is stamped to the partner who holds it.";
    return linked(`${list.length} ${plural(list.length, "record sits", "records sit")} in a market-wide territory stamped to a different partner or to none: ${list.slice(0, 6).map((c) => `${c.name} in ${c.market} (territory: ${c.territoryDealLabel})`).join("; ")}${list.length > 6 ? `; and ${list.length - 6} more` : ""}. The money already follows the deal; stamp or mark each one reviewed on the Partners view.`, "Review conflicts", "admin-partners");
  }
  if (hasPhrase(t, "who owns", "who holds", "is exclusive", "exclusive", "territory") && market) {
    const askedKey = market.toLowerCase() === "hampton roads" ? "virginia beach" : market.toLowerCase();
    const holder = (f.deals || []).find((x) => (x.status === "signed" || x.status === "live") && (x.liveMarkets || []).some((m) => m.toLowerCase() === askedKey));
    if (!holder) return `No signed or live deal holds ${market}, so nobody owns that territory right now. Sign-ups there are stamped only when they arrive through a partner link.`;
    const heldMarket = (holder.liveMarkets || []).find((m) => m.toLowerCase() === askedKey) || market;
    return `${holder.partnerName || "The partner"} holds ${heldMarket} under "${holder.label}" (${holder.status}): ${holder.attributionScope === "sourced_only" ? "only businesses that partner brought in count toward the deal" : "the whole market counts, and direct sign-ups there are stamped to them automatically"}. Exclusivity: ${holder.exclusivity === "market_conditional" ? "conditional — a second signed deal or pilot in this market is blocked unless the recorded override path is used" : "none recorded, so another deal could still be signed there"}.`;
  }

  // Breakdowns
  if (hasPhrase(t, "by market", "per market", "each market", "breakdown", "break it down", "break down") && !hasWord(t, "tier", "plan")) {
    if (!c.byMarket.length) return "No creators on file yet, so there is no market breakdown to show.";
    const rows = c.byMarket.slice(0, 8).map((m) => `${m.market}: ${fmt(m.creators)} creators (${fmt(m.approved)} approved, ${fmt(m.complete)} finished)`);
    const more = c.byMarket.length > 8 ? `; and ${c.byMarket.length - 8} more markets` : "";
    return `Creators by market: ${rows.join("; ")}${more}.`;
  }
  if (hasPhrase(t, "by tier", "per tier", "each tier") || (hasWord(t, "breakdown", "break") && hasWord(t, "tier"))) {
    if (!c.byTier.length) return "No approved creators yet, so no tiers to break down.";
    return `Approved creators by tier: ${c.byTier.map((x) => `${x.tier} ${fmt(x.count)}`).join(", ")}. Tiers come from stacked audience across platforms and set themselves.`;
  }
  if (hasPhrase(t, "by plan", "per plan", "each plan") || (hasWord(t, "breakdown", "break") && hasWord(t, "plan"))) {
    if (!b.byPlan.length) return "No approved businesses yet, so no plan breakdown to show.";
    return `Approved businesses by plan: ${b.byPlan.map((x) => `${x.plan} ${fmt(x.count)}`).join(", ")}.`;
  }

  // Co-brand (Build -105): which partners carry a brand block,
  // and which are missing a logo. Brand is Admin-set on the
  // partner record; the answer links to the editor.
  if (hasWord(t, "brand", "branding", "branded", "logo", "logos") || hasPhrase(t, "co-brand", "cobrand", "co brand")) {
    if (!f.partners.list.length) return "No partners yet, so no co-branding is set. Partners are created under the Partners tab, and their brand block is set in the same editor.";
    const branded = f.partners.list.filter((p) => p.brandSet);
    const unbranded = f.partners.list.filter((p) => !p.brandSet);
    const noLogo = branded.filter((p) => !p.hasLogo);
    const bits = [];
    bits.push(branded.length ? `${fmt(branded.length)} of ${fmt(f.partners.total)} ${plural(f.partners.total, "partner")} ${plural(branded.length, "carries", "carry")} a co-brand: ${branded.map((p) => `${p.name}${p.brandName ? ` (shown as ${p.brandName})` : ""}`).join("; ")}` : `No partner has a co-brand set yet`);
    if (unbranded.length) bits.push(`No brand set: ${unbranded.map((p) => p.name).join("; ")}`);
    if (noLogo.length) bits.push(`Branded but no logo on file: ${noLogo.map((p) => p.name).join("; ")}`);
    return linked(bits.join(". ") + ". A partner's brand leads their portal and invite emails, with Powered by SIGNL underneath; it never replaces the SIGNL name.", "Set branding on Partners", "admin-partners");
  }

  // Partners
  if (hasWord(t, "partner", "partners")) {
    if (hasPhrase(t, "who", "list", "show", "names")) {
      if (!f.partners.list.length) return "No partners yet. Partners are created under the Partners tab.";
      return linked(`${fmt(f.partners.total)} ${plural(f.partners.total, "partner")}: ${f.partners.list.map((p) => `${p.name} (${p.status}${p.markets.length ? ", " + p.markets.join(" + ") : ""})`).join("; ")}.`, "Open Partners", "admin-partners");
    }
    if (countAsk || hasWord(t, "active", "paused")) {
      return `${fmt(f.partners.total)} ${plural(f.partners.total, "partner")} in total: ${fmt(f.partners.active)} active, ${fmt(f.partners.paused)} paused.`;
    }
    return null; // "how do partners work" is canon
  }

  // Markets live
  if (hasWord(t, "market", "markets") && (hasWord(t, "live", "open", "active") || hasPhrase(t, "which markets", "what markets"))) {
    if (!market) {
      if (!f.markets.liveCount) return "No markets are live yet. Every market is still in its founding stage, and activation is a manual step under Markets.";
      return `${fmt(f.markets.liveCount)} ${plural(f.markets.liveCount, "market")} live: ${f.markets.liveNames.join(", ")}.`;
    }
  }

  // Compliance / overdue
  if (hasWord(t, "overdue", "compliance") || hasPhrase(t, "late post", "posts overdue", "posts are late")) {
    return linked(`${fmt(f.visits.overduePosts)} ${plural(f.visits.overduePosts, "post")} overdue right now, and ${fmt(f.visits.awaitingPost)} ${plural(f.visits.awaitingPost, "visit")} still inside the window waiting on a post. The Compliance tab runs the sweep; an overdue visit falls under the Visit Guarantee and is replaced for the business in credits.`, "Open Compliance", "admin-compliance");
  }

  // Offers / campaigns
  if (hasWord(t, "offer", "offers", "campaign", "campaigns")) {
    const o = f.offers;
    if (hasWord(t, "draft", "drafts")) return `${fmt(o.draft)} draft ${plural(o.draft, "offer")} saved and not published. ${fmt(o.open)} are open.`;
    if (hasWord(t, "open", "live")) {
      if (market && o.openByMarket.length) { const r = o.openByMarket.find((x) => x.market.toLowerCase() === market.toLowerCase()); return `${fmt(r ? r.count : 0)} open offers in ${market} right now, out of ${fmt(o.open)} open platform-wide.`; }
      return `${fmt(o.open)} offers open right now, out of ${fmt(o.total)} in total (${fmt(o.draft)} drafts, ${fmt(o.filled)} filled, ${fmt(o.closed)} closed).`;
    }
    if (countAsk) return `${fmt(o.total)} offers in total: ${fmt(o.open)} open, ${fmt(o.draft)} drafts, ${fmt(o.filled)} filled, ${fmt(o.closed)} closed, ${fmt(o.expired)} expired.`;
    return null;
  }

  // Visits / bookings / posts
  if (hasWord(t, "visit", "visits", "booking", "bookings") && countAsk) {
    const v = f.visits;
    return `${fmt(v.bookings)} bookings in total: ${fmt(v.completed)} completed, ${fmt(v.upcoming)} booked and coming up, ${fmt(v.postsLive)} posts live from them.`;
  }
  if (hasWord(t, "post", "posts") && countAsk) {
    const v = f.visits;
    return `${fmt(v.postsLive)} posts live in total. ${fmt(v.awaitingPost)} visits are still waiting on a post inside the window, and ${fmt(v.overduePosts)} are overdue.`;
  }

  // Applications count (a named side gets that side's number)
  if (hasWord(t, "application", "applications") && (countAsk || hasWord(t, "pending", "waiting"))) {
    if (hasWord(t, "creator", "creators") && !hasWord(t, "business", "businesses")) return `${fmt(c.pending)} creator ${plural(c.pending, "application")} pending a decision, out of ${fmt(c.total)} creators in total. Every applicant is owed an answer within 2 business days.`;
    if (hasWord(t, "business", "businesses") && !hasWord(t, "creator", "creators")) return `${fmt(b.pending)} business ${plural(b.pending, "application")} pending a decision, out of ${fmt(b.total)} businesses in total. Every applicant is owed an answer within 2 business days.`;
    return `${fmt(f.waiting.total)} applications waiting on a decision: ${fmt(f.waiting.creators)} ${plural(f.waiting.creators, "creator")} and ${fmt(f.waiting.businesses)} ${plural(f.waiting.businesses, "business", "businesses")}. Every applicant is owed an answer within 2 business days.`;
  }

  // Businesses
  if (hasWord(t, "business", "businesses")) {
    const planName = hasPhrase(t, "self-service", "self service") ? "Self-Service" : hasWord(t, "growth") ? "Growth" : hasWord(t, "managed") ? "Managed" : null;
    if (planName) { const r = b.byPlan.find((p) => p.plan === planName); return `${fmt(r ? r.count : 0)} approved ${plural(r ? r.count : 0, "business", "businesses")} on the ${planName} plan, out of ${fmt(b.approved)} approved businesses.`; }
    if (hasWord(t, "founding")) return `${fmt(b.founding)} approved ${plural(b.founding, "business", "businesses")} on the founding list, waiting for activation. ${fmt(b.active)} ${plural(b.active, "business", "businesses")} ${b.active === 1 ? "is" : "are"} active.`;
    if (hasWord(t, "active")) return `${fmt(b.active)} ${plural(b.active, "business", "businesses")} active right now, and ${fmt(b.founding)} approved and waiting on the founding list.`;
    if (hasWord(t, "pending", "waiting")) return `${fmt(b.pending)} business ${plural(b.pending, "application")} pending a decision.`;
    if (hasWord(t, "approved")) return `${fmt(b.approved)} approved businesses: ${fmt(b.active)} active and ${fmt(b.founding)} on the founding list.`;
    if (market) {
      const mr = c.byMarket.find((m) => m.market.toLowerCase() === market.toLowerCase());
      return `${fmt(mr ? mr.bizApproved : 0)} approved businesses in ${market} (${fmt(mr ? mr.bizActive : 0)} active), out of ${fmt(mr ? mr.businesses : 0)} on file there.`;
    }
    if (countAsk) return `${fmt(b.total)} businesses in total: ${fmt(b.approved)} approved (${fmt(b.active)} active, ${fmt(b.founding)} on the founding list), ${fmt(b.pending)} pending, ${fmt(b.rejected)} rejected.${b.testers ? ` ${fmt(b.testers)} tester ${plural(b.testers, "record")} not counted.` : ""}`;
    return null;
  }

  // Tier counts (asked without the word "creator" half the time)
  {
    const tierName = hasWord(t, "neighbors") ? "Neighbors" : hasWord(t, "locals") ? "Locals" : hasWord(t, "headliners") ? "Headliners" : null;
    if (tierName && (countAsk || hasWord(t, "tier", "tiers"))) { const r = c.byTier.find((x) => x.tier === tierName); return `${tierName}: ${fmt(r ? r.count : 0)} approved ${plural(r ? r.count : 0, "creator")}, out of ${fmt(c.approved)} approved creators. Tiers come from stacked audience across platforms.`; }
  }

  // Creators (Jeff's question lands here)
  if (hasWord(t, "creator", "creators")) {
    if (market && row) {
      const live = marketLive(f, market);
      if (hasWord(t, "approved")) return `${fmt(row.approved)} approved ${plural(row.approved, "creator")} in ${market}, and ${fmt(row.complete)} of them have finished profiles. ${market} is ${live ? "live" : "not live yet"}.`;
      if (hasPhrase(t, "finished", "complete", "profile complete", "profiles finished", "ready")) return `${fmt(row.complete)} ${plural(row.complete, "creator")} in ${market} ${row.complete === 1 ? "has" : "have"} finished profiles, out of ${fmt(row.approved)} approved there. Finished profiles are the roster businesses can see.`;
      if (hasWord(t, "pending", "waiting")) return `${fmt(row.pending)} creator ${plural(row.pending, "application")} pending in ${market}, out of ${fmt(row.creators)} creator records there.`;
      return `${fmt(row.creators)} ${plural(row.creators, "creator")} in ${market}: ${fmt(row.approved)} approved (${fmt(row.complete)} with finished profiles), ${fmt(row.pending)} pending. ${market} is ${live ? "live" : "not live yet"}.`;
    }
    if (hasWord(t, "pending", "waiting")) return `${fmt(c.pending)} creator ${plural(c.pending, "application")} pending a decision, out of ${fmt(c.total)} creators in total.`;
    if (hasWord(t, "approved")) return `${fmt(c.approved)} approved creators, and ${fmt(c.complete)} of them ${c.complete === 1 ? "has" : "have"} finished profiles.`;
    if (hasPhrase(t, "finished", "complete", "profiles")) return `${fmt(c.complete)} creators have finished profiles, out of ${fmt(c.approved)} approved. Finished profiles are the launch number: they are the roster businesses can see.`;
    if (hasWord(t, "rejected")) return `${fmt(c.rejected)} ${plural(c.rejected, "creator")} rejected, out of ${fmt(c.total)} in total.`;
    if (countAsk || hasWord(t, "total")) {
      return `${fmt(c.total)} creators in total: ${fmt(c.approved)} approved, ${fmt(c.pending)} pending, ${fmt(c.rejected)} rejected. ${fmt(c.complete)} of the approved ${c.complete === 1 ? "has" : "have"} finished profiles, and finished profiles are the roster businesses can see.${c.testers ? ` ${fmt(c.testers)} tester ${plural(c.testers, "record")} not counted in any of those numbers.` : ""}`;
    }
    return null;
  }

  // Bare totals
  if (hasPhrase(t, "platform numbers", "the numbers", "overall") || (hasWord(t, "stats") && countAsk)) {
    return `Platform totals: ${fmt(c.total)} creators (${fmt(c.approved)} approved, ${fmt(c.complete)} finished profiles), ${fmt(b.total)} businesses (${fmt(b.active)} active), ${fmt(f.offers.open)} offers open, ${fmt(f.visits.postsLive)} posts live, ${fmt(f.partners.total)} partners, ${fmt(f.markets.liveCount)} markets live.`;
  }
  return null;
}

// ---------- BUSINESS ----------
function answerBusiness(f, q, t) {
  // Creator terms (Build -98, item 4): when a business asks
  // about creator terms, the plain-words page link rides along.
  if (hasWord(t, "terms") && hasPhrase(t, "creator")) {
    return linked("Creator terms in plain words are on the creator terms page: https://joinsignl.com/creator-terms.html. The short version for your side: a comped visit is native share only, and a paid booking includes one standard licence for 90 days, never longer.", "Read creator terms in plain words", "cr-terms");
  }
  // Setup checklist (Build -99): the ONE setup surface on
  // Home. Sig answers what is left from the same records the
  // checklist renders, and walks the business to Home, where
  // every item's own button lands on its real surface.
  if (hasPhrase(t, "whats left to set up", "what is left to set up", "left to set up", "finish setting up", "setup checklist", "set up checklist", "my checklist", "the checklist", "what do i still need", "still need to set up", "what should i set up", "get the most from signl", "get the most out of signl")) {
    if (!f.setup) return linked("Your setup checklist lives on Home, under Get the most from SIGNL. Every item there is read from your real records, and the list goes away when all nine are done.", "Open the setup checklist", "biz-home");
    if (f.setup.allDone) return linked("Nothing is left to set up: all nine items on your setup checklist are done, so the checklist has retired from Home. Your register, your page, your hours, and your first campaign draft are all in place.", "Open Home", "biz-home");
    const left = f.setup.remaining.map((i) => i.label).join("; ");
    return linked(`You have ${fmt(f.setup.doneCount)} of ${fmt(f.setup.total)} setup items done. Still to do: ${left}. The whole list is on Home, under Get the most from SIGNL, and each item's button takes you straight to where that step lives.`, "Open the setup checklist", "biz-home");
  }
  // Square register connect (Build -99): the connect action
  // moved from Proof Controls in Results to the setup
  // checklist on Home. Results keeps the register status, the
  // Which till (Build -101): what register system the business
  // declared, and what that means honestly for each system.
  if (hasPhrase(t, "which till", "what till", "my till", "till do i", "register system", "pos system", "point of sale", "what pos", "which pos", "which register", "what register", "do i use square", "do i use clover", "do i use toast", "clover", "toast", "lightspeed")) {
    const pos = f.setup && f.setup.pos;
    if (!pos) return linked("You have not told us which till you run yet. It is one tap on the setup checklist on Home (Tell us which till you run) or on your business page, and it only changes how visits get counted later: visit codes count at every till today, whichever system it is.", "Open the setup checklist", "biz-home");
    if (pos.provider === "square") return linked("You told us Square, and Square is the register SIGNL connects directly today: connect it from the setup checklist on Home and code visits count themselves from the register.", "Open the setup checklist", "biz-home");
    if (pos.provider === "none") return linked("You told us you run no register system. That is fine: visit codes are redeemed at the counter with your staff PIN, and that tap is what counts the visit.", "Open the setup checklist", "biz-home");
    return linked(`You told us ${pos.label}${pos.other ? ` (${pos.other})` : ""}. Your visit codes count at the till today. A direct ${pos.label} connection is on the roadmap once enough businesses ask for it; no date is promised, and nothing about your counting waits on it. You can change the answer any time on your business page.`, "Open your business page", "biz-profile");
  }
  // counted data, and the connected/paused management.
  if (hasPhrase(t, "connect square", "square register", "connect my register", "connect the register", "connect a register", "hook up square", "link square", "register connected", "square connected", "reconnect square", "reconnect my register")) {
    const sq = f.setup && f.setup.square;
    if (sq && sq.state === "connected") return linked("Your Square register is connected, and code visits and come-backs count themselves from it. The connection, its locations, and the disconnect live in Results, under your proof controls; Results is also where the counted numbers land.", "Open Results", "biz-results");
    if (sq && sq.state === "paused") return linked("Your register is paused: Square stopped sharing checks, and your codes still count at the till. Reconnect from the setup checklist on Home, or from Results under your proof controls.", "Open the setup checklist", "biz-home");
    if (sq && !sq.configured) return linked("Your register connects on your setup call: we plug into your register with you, one tap on your end. Until then your codes count on the register you already have. The setup checklist on Home holds the item and says the same.", "Open the setup checklist", "biz-home");
    return linked("Your register is not connected yet. Connect it from the setup checklist on Home, under Get the most from SIGNL: tap Connect Square there and sign in once, and after that code visits and come-backs count themselves from the register. Not on Square? Skip it; the codes count your visits either way.", "Connect Square from the checklist", "biz-home");
  }
  // Monthly receipt export (Build -96)
  if (hasPhrase(t, "monthly receipt", "receipt export", "export my receipt", "forward my receipt", "forward the receipt", "receipt for my bookkeeper", "bookkeeper", "download my receipt", "my receipt", "the receipt")) {
    if (f.receiptReady) return linked(`Your ${f.receiptReady.monthLabel} receipt is ready to forward. It keeps counted, recorded, and intent figures in three separate sections, with visits used and rolled over, your founding credit state, and the end date of every licence you hold. Download the CSV or open the print view from Results and send it on.`, "Open Results", "biz-results");
    return linked("Your forwardable monthly receipt lives in Results: pick a month and download the CSV or open the print view. It keeps counted, recorded, and intent figures in three separate sections, with visits used and rolled over, your founding credit state, and the end date of every licence you hold. A month with no activity exports honest zeros.", "Open Results", "biz-results");
  }
  // Standing availability (Build -96)
  if (hasPhrase(t, "standing availability", "standing hours", "my hours", "our hours", "opening hours", "open hours", "when are we open", "when am i open", "when can creators come", "when creators can come") || hasWord(t, "availability")) {
    if (f.availabilitySet) return linked(`Your standing availability, shown to creators on your offers: ${f.availabilitySummary}. It pre-fills the timing on new offers, and a per-offer note still wins for that offer. Change it any time on your business page.`, "Open your business page", "biz-profile");
    return linked("You have not set standing availability yet. Set your usual open days and hours once on your business page, and creators see them on your offers while new offers pre-fill their timing from them. Until then, every offer carries its own timing note.", "Set it on your business page", "biz-profile");
  }
  // My numbers digest
  if (hasPhrase(t, "my numbers", "my stats", "show me my", "how am i doing", "my dashboard")) {
    return linked(`Your numbers: ${fmt(f.offersLive)} offers live, ${fmt(f.applicantsWaiting)} applicants waiting on your answer, ${fmt(f.visitsBooked)} visits booked, ${fmt(f.postsLive)} posts live, ${money(f.countedDollars)} counted at the register.${f.intentTotal > 0 ? ` Those posts drew ${fmt(f.intentTotal)} saves and shares (intent: people planning to come).` : ""} You have ${fmt(f.visitsRemaining)} of ${fmt(f.visitsAllowance)} visits left this month on ${f.planName || "your plan"}.`, "See Results", "biz-results");
  }
  // Visits left
  if ((hasWord(t, "visit", "visits") && hasPhrase(t, "left", "remaining", "do i have")) || hasPhrase(t, "visits left", "visits remaining")) {
    return `${fmt(f.visitsRemaining)} visits left this month. You have used ${fmt(f.visitsUsed)} of ${fmt(f.visitsAllowance)} on the ${f.planName || "plan"} allowance${f.visitsCarried ? `, including ${fmt(f.visitsCarried)} rolled over from last month (rolled visits expire at month end)` : ""}. Paid bookings sit on top and never use the allowance.`;
  }
  // My plan
  if (hasPhrase(t, "my plan", "what plan", "plan am i on", "plan do i have")) {
    if (!f.planName) return "I do not see a plan on your account yet. Your plan shows under Plan and billing; it was picked at sign-up.";
    return `You are on ${f.planName}: ${money(f.planPrice)} a month for ${fmt(f.visitsPerMonth)} creator visits a month. Founding rate, held while the plan stays active, with ${money(f.foundingCredit)} off the first month and a 3 month minimum.${f.founding ? " No card is charged while you are on the founding list." : ""}`;
  }
  // Founding credit
  if (hasWord(t, "credit") || hasPhrase(t, "$100", "100 off")) {
    return `Your founding credit is ${money(f.foundingCredit)} off your first month, so month one is ${money(Math.max(0, (f.planPrice || 0) - f.foundingCredit))} instead of ${money(f.planPrice)}. ${f.founding ? "It lands when billing starts at activation; nothing is charged while you are on the founding list." : "It was applied to your first charged month."}`;
  }
  // Applicants
  if (hasWord(t, "applicant", "applicants", "applications") && hasPhrase(t, "my", "me", "waiting", "how many", "answer", "applied")) {
    if (!f.applicantsWaiting) return "No applicants are waiting on you right now. When a creator applies to one of your offers, they land here, and every applicant gets an answer within 2 business days.";
    return linked(`${fmt(f.applicantsWaiting)} ${plural(f.applicantsWaiting, "applicant")} waiting on your answer. Every applicant gets an answer within 2 business days, and the app tracks it, so answering promptly is the move.`, "Review applicants", "biz-applicants");
  }
  // Campaign setup (Build -97): building and checking are
  // two separate views now, and Sig guides the setup.
  if (hasPhrase(t, "set up a campaign", "setup a campaign", "new campaign", "start a campaign", "create a campaign", "make a campaign", "build a campaign", "first campaign")) {
    return linked(`Set up a campaign is its own view. Tell Sig what you want in your own words there, and Sig fills in what it already knows about your business, asks only for what is missing one question at a time, and shows you the full draft before anything is saved.${f.founding ? " While your market is founding, the draft saves for opening day and nothing sends to a creator." : " The draft lands in Your campaigns, where you check on it."}`, "Set up a campaign", "biz-setup");
  }
  // My offers
  if ((hasWord(t, "offer", "offers", "campaign", "campaigns")) && hasPhrase(t, "my", "how many", "do i have", "live", "draft")) {
    const offersText = `You have ${fmt(f.offersLive)} offers live and ${fmt(f.draftOffers)} in draft, out of ${fmt(f.visitsBooked)} visits booked from them so far.${f.founding ? " Your market is not open yet, so drafts save for opening day and nothing sends until it activates." : ""}`;
    return (f.offersLive || f.draftOffers) ? linked(offersText, "Open Your campaigns", "biz-offers") : offersText;
  }
  // Results
  if (hasPhrase(t, "my results", "how are my", "how is my", "register", "counted", "sales", "return on") || (hasWord(t, "results") && hasWord(t, "my", "me"))) {
    if (!f.visitsBooked && !f.postsLive) return `Nothing counted yet: no visits have run, so there are no register dollars to show. Results count only what a visit code rings up, and nothing is shown before it is real.${f.founding ? " Your first results land after your market opens and your first visits run." : ""}`;
    return linked(`Your counted results: ${money(f.countedDollars)} counted at the register across ${fmt(f.postsLive)} live posts and ${fmt(f.visitsRedeemed)} redeemed visits.${f.modeledDollars ? ` On top sits a modeled estimate of ${money(f.modeledDollars)}; that figure is an estimate, not counted sales.` : ""} ${f.intentTotal > 0 ? ` Those posts also drew ${fmt(f.intentTotal)} saves and shares, recorded by the creators: intent, people planning to come.` : ""} Counted means rung up through visit codes, the only dollars Sig and your dashboard ever call real.`, "See Results", "biz-results");
  }
  // Roster in her market
  if ((hasWord(t, "creator", "creators", "roster") || hasPhrase(t, "can i book", "who can i book")) && hasPhrase(t, "my market", "in my", "near me", "can i book", "how many", "book in")) {
    const rosterText = `${fmt(f.rosterInMarket)} ${plural(f.rosterInMarket, "creator")} with finished profiles on the roster in ${f.market || "your market"} right now. ${f.founding ? "Booking opens when your market activates, and that finished roster is who you meet on day one." : "They are ranked by local reach in Find creators, and you can invite any of them at their listed rate."}`;
    return f.rosterInMarket ? linked(rosterText, "Find creators", "biz-discover") : rosterText;
  }
  // Visits booked/done
  if (hasWord(t, "visit", "visits") && hasPhrase(t, "booked", "done", "completed", "have i", "so far")) {
    const visitsText = `${fmt(f.visitsBooked)} visits booked so far: ${fmt(f.visitsRedeemed)} redeemed at the counter and ${fmt(f.postsLive)} posts live from them.`;
    return f.visitsBooked ? linked(visitsText, "Open Visits and posts", "biz-visits") : visitsText;
  }
  // My Regulars (Build -95)
  if (hasWord(t, "regular", "regulars") || hasPhrase(t, "book again", "rebook", "visited before", "been here before", "came back", "who has visited", "creators who visited")) {
    if (!f.regularsCount) return linked("No Regulars yet. A creator becomes one of your Regulars the day a visit with them is completed and their post is live. Then they sit in your Regulars view with the deal that ran and a Book again button.", "Open Regulars", "biz-regulars");
    const list = f.regulars.slice(0, 5).map((r) => `${r.name}${r.handle ? " (@" + r.handle + ")" : ""}: ${fmt(r.visits)} ${plural(r.visits, "visit")}, last one ${r.lastVisitAt ? String(r.lastVisitAt).slice(0, 10) : "on record"}${r.rebookedSince ? ", already rebooked since" : ""}`).join("; ");
    return linked(`You have ${fmt(f.regularsCount)} ${plural(f.regularsCount, "Regular")}: ${list}. Book again on any of them clones the last visit's deal into a new draft; nothing sends until you publish it.`, "Open Regulars", "biz-regulars");
  }
  // Licences ending soon (Build -95)
  if ((hasWord(t, "license", "licenses", "licence", "licences")) && hasPhrase(t, "expir", "ending", "ends", "renew", "run out", "running out")) {
    if (!f.licencesExpiring || !f.licencesExpiring.length) return linked("No licences are ending in the next 14 days. Every licence you hold shows its end date in Posts and licenses, and you get an alert 14 days and again 1 day before one ends.", "Open Posts and licenses", "biz-content");
    const list = f.licencesExpiring.map((l) => `${l.creatorName || "A creator"}'s post "${l.title}" ends ${l.endsOn}${l.ended ? " (already ended)" : ` (${fmt(Math.max(0, l.daysLeft))} ${plural(Math.max(0, l.daysLeft), "day")} left)`}`).join("; ");
    return linked(`Ending soon: ${list}. Ask to renew from Posts and licenses: the request goes to the creator at their listed fee, and a fresh 90 days starts only if they approve. Nothing renews on its own.`, "Ask to renew", "biz-content");
  }
  // Licenses
  if (hasWord(t, "license", "licenses", "licensing") && hasPhrase(t, "my", "how many", "waiting", "pending")) {
    const licText = `Your licenses: ${fmt(f.licensesGranted)} granted and in your library, ${fmt(f.licensesPending)} requested and waiting on the creator's answer. Each granted license is 90 days of repost and ad use, and its end date sits on the post in Posts & licenses.`;
    return (f.licensesGranted || f.licensesPending) ? linked(licText, "Open Posts and licenses", "biz-content") : licText;
  }
  return null;
}

// ---------- CREATOR ----------
function answerCreator(f, q, t) {
  // Creator terms (Build -98, item 4): a terms question always
  // carries the plain-words terms page link with it.
  if (hasWord(t, "terms") || hasPhrase(t, "creator terms")) {
    return linked("The short version: a comped visit is one post plus one story, native share only. A paid booking pays your listed rate, you keep 97%, and it includes one standard licence for 90 days, never longer. The full version is on the creator terms page: https://joinsignl.com/creator-terms.html", "Read creator terms in plain words", "cr-terms");
  }
  // Payout setup paperwork (Build -98, 11h): the explainer's
  // content, from the creator's own payout state, linked to
  // the payout surface on Profile.
  if (hasPhrase(t, "payout setup", "set up payouts", "setup payouts", "what will stripe ask", "stripe ask", "1099", "payout paperwork", "payouts ask", "payout ask")
    || (hasWord(t, "payout", "payouts") && hasPhrase(t, "ask", "need", "setup", "set up", "paperwork", "tax", "bank", "identity", "stripe"))) {
    const stateLine = f.payoutsReady ? "Your payouts are ready on your record." : "Your payouts are not set up yet on your record.";
    return linked(`Payout setup runs on Stripe's secure pages, from the paid lane on your Profile. Stripe will ask for identity details, because payment companies have to check who money is going to. It will ask for your address, as part of that check, and your bank account, so money can go to your bank; bank details go to Stripe, never to SIGNL. It will ask for tax information, so paid earnings can be reported the right way. If your paid earnings pass the reporting threshold for a tax year, you may get a Form 1099-K for that year; it is a tax record, not a bill. Your first payout can be held briefly while identity checks clear. Paid bookings are recorded in the app and settled with help until the payout rail fully opens, so setup promises no payout date. ${stateLine}`, "Set up payouts on my Profile", "cr-profile");
  }
  // Rate starting points (Build -98, 11g): the tier defaults
  // that pre-fill blank rate boxes, stated as editable
  // starting points, never a mandate, and never overwriting
  // a rate the creator already set.
  if (hasPhrase(t, "starting point", "starting rate", "starting default", "starting fee", "should i charge", "what should i charge", "rate should i", "default rate")
    || (hasWord(t, "rate", "rates", "charge", "fee") && hasPhrase(t, "starting", "default"))) {
    const d = f.rateStarting || { tier: f.tier || "Neighbors", paidRate: 120, licensingFee: 80 };
    if (f.paidRate || f.licenseFee) return linked(`Your own rates are already set, and starting points never overwrite them: paid rate ${f.paidRate ? cmoney(f, f.paidRate) : "not set"}, licensing fee ${f.licenseFee ? cmoney(f, f.licenseFee) : "not set"}. Starting points only fill blank boxes. For ${d.tier}, the starting point is a paid rate of ${cmoney(f, d.paidRate)} and a licensing fee of ${cmoney(f, d.licensingFee)}, and it is editable, not a price you have to use.`, "Open my Profile", "cr-profile");
    return linked(`Because your rate boxes are blank, they start at a starting point for your ${d.tier} tier: a paid rate of ${cmoney(f, d.paidRate)} and a licensing fee of ${cmoney(f, d.licensingFee)}. Change them to whatever you charge. They are starting points only, not a price you have to use, and nothing is saved until you save it on your Profile.`, "Set my rates", "cr-profile");
  }
  // A business's standing availability (Build -96): answered
  // from the real business page record, for the businesses
  // this creator can meet. A named business wins; a single
  // business on file answers a bare "when are they open".
  if ((hasWord(t, "open", "hours", "availability") || hasPhrase(t, "when can i come", "when can i visit", "what time")) &&
      hasPhrase(t, "when", "what", "open", "hours", "availability", "come in", "visit")) {
    const list = f.businessAvailability || [];
    const ql = " " + String(q || "").toLowerCase() + " ";
    const named = list.find((b) => ql.includes(" " + b.businessName.toLowerCase()) || ql.includes(b.businessName.toLowerCase()));
    if (named) return linked(`${named.businessName} set its standing hours on its business page: ${named.summary}. The offer's own window and note still apply to a specific visit.`, "See the offer", "cr-offers");
    if (list.length === 1) return linked(`${list[0].businessName} set its standing hours on its business page: ${list[0].summary}. The offer's own window and note still apply to a specific visit.`, "See the offer", "cr-offers");
    if (list.length > 1) return linked(`Standing hours on file: ${list.slice(0, 5).map((b) => `${b.businessName}: ${b.summary}`).join("; ")}. Any other business has not set theirs; its offer window and note are what applies.`, "See the offers", "cr-offers");
    if (hasPhrase(t, "when is", "when are", "what are the hours", "their hours", "its hours")) return "That business has not set standing hours on its page yet. The offer's own window and note are what applies to your visit.";
  }
  // My numbers digest
  if (hasPhrase(t, "my numbers", "my stats", "show me my", "how am i doing")) {
    return linked(`Your numbers: ${fmt(f.momentumPoints)} Momentum points (level ${f.level ? f.level.name : "Starter"}), ${fmt(f.offersOpen)} open offers in your markets, ${fmt(f.applicationsPending)} applications waiting on an answer, ${fmt(f.visitsBooked)} visits booked, ${fmt(f.postsLive)} posts live, and ${money(f.paidRecordedNet)} recorded from paid bookings.${f.intentTotal > 0 ? ` Your posts have drawn ${fmt(f.intentTotal)} saves and shares so far (intent: people planning to come).` : ""}`, "Open Your numbers", "cr-numbers");
  }
  // Why / recent Momentum (before the plain points answer: "why" wins)
  if ((hasWord(t, "momentum", "points")) && hasPhrase(t, "why", "recent", "last", "change", "changed", "come from", "go up", "dropped", "earn them", "earned")) {
    if (!f.recentLedger.length) return "No points on your ledger yet. Points land for finishing your profile, posting on time, reviews, and invites; the Momentum list on your Home shows every way to earn.";
    const bits = f.recentLedger.map((e) => `${e.points > 0 ? "+" : ""}${fmt(e.points)} for ${String(e.label || "an entry").replace(/\.$/, "").toLowerCase()}`).join("; ");
    return linked(`Your most recent points: ${bits}. That puts you at ${fmt(f.momentumPoints)} in total. Points are priority, not cash: they order the list businesses see.`, "See my Momentum", "cr-momentum");
  }
  // My Momentum / points total
  if ((hasWord(t, "momentum", "points") && hasPhrase(t, "my", "how many", "do i have", "have i got")) || hasPhrase(t, "my momentum")) {
    if (hasPhrase(t, "how does", "how do i earn", "how to earn", "earn more")) return null; // canon explains earning
    const lv = f.level;
    const next = lv && lv.nextName ? ` ${fmt(lv.nextAt - f.momentumPoints)} more points reaches ${lv.nextName}, and higher levels see new offers earlier.` : " That is the top level.";
    return `${fmt(f.momentumPoints)} Momentum points. That is level ${lv ? lv.name : "Starter"}.${next}`;
  }
  // Level
  if (hasPhrase(t, "my level", "what level", "next level")) {
    const lv = f.level;
    if (!lv) return null;
    return `You are ${lv.name} at ${fmt(f.momentumPoints)} points.${lv.nextName ? ` Next is ${lv.nextName} at ${fmt(lv.nextAt)} points, so ${fmt(lv.nextAt - f.momentumPoints)} to go. In a live market ${lv.nextName} sees new offers ${lv.nextName === "Regular" ? "12" : lv.nextName === "Standout" ? "18" : "24"} hours early.` : " Cornerstone is the top level."}`;
  }
  // Tier
  if (hasPhrase(t, "my tier", "what tier", "tier am i")) {
    if (!f.tier) return "No tier on your record yet. Tiers set themselves from your stacked audience once your counts are in: Neighbors 500 to 2,000, Locals 2,000 to 15,000, Headliners 15,000 and up.";
    return `You are ${f.tier}${f.audienceTotal != null ? `, on ${fmt(f.audienceTotal)} total followers counted across your platforms` : ""}. Tiers come from that stacked audience and set themselves: Neighbors 500 to 2,000, Locals 2,000 to 15,000, Headliners 15,000 and up.`;
  }
  // Local reach (mine)
  if ((hasPhrase(t, "my local") || (hasWord(t, "local") && hasPhrase(t, "mine", "my %", "my percent", "my share"))) && !hasPhrase(t, "what is local", "what does local")) {
    if (f.localPct == null) return "You have not reported your local audience share yet. It is one of the four things a finished profile needs, and it is the number businesses rank by.";
    return `${f.localPct}% of your audience is local to ${f.market || "your home market"}. Local reach, that share applied to your audience size, is the number businesses rank creators by, not follower count.`;
  }
  // Public roster page (Build -102)
  if (hasPhrase(t, "public roster", "roster page", "on the roster page", "public page for my market", "market roster")) {
    if (f.publicRoster && f.publicRoster.length) return linked(`Yes: you are on the public roster for ${f.publicRoster.map((r) => r.market).join(" and ")}. The page shows finished founding creators in that market ranked by local audience, and your card links to your profile.`, "See the roster page", f.publicRoster[0].url);
    return linked(`Not yet. A market's public roster page opens when at least 5 finished public profiles are listed in it; below that it would be a thin page, so it stays closed. ${f.profileComplete ? "Your profile is finished, so you will be on it the moment your market crosses." : `Your profile is not finished yet${f.missingLabels && f.missingLabels.length ? " (missing: " + f.missingLabels.join(", ") + ")" : ""}; finishing it is the step that puts you on the page when your market crosses.`}`, "Open my Profile", "cr-profile");
  }
  // Markets listed in
  if (hasPhrase(t, "markets am i", "which markets", "markets i am", "listed in", "am i listed")) {
    if (!f.listedMarkets.length) return "Your home market is the listing on your record. Add per-market audience shares on your profile and you list in every market where your local share is 5% or more.";
    return linked(`You are listed in ${f.listedMarkets.length} ${plural(f.listedMarkets.length, "market")}: ${f.listedMarkets.map((m) => `${m.market}${m.pct != null ? " (" + m.pct + "% local)" : ""}${m.home ? ", your home market" : ""}`).join("; ")}. You can receive offers from businesses in all of them.`, "Open my Profile", "cr-profile");
  }
  // Offers waiting
  if (hasWord(t, "offer", "offers") && hasPhrase(t, "waiting", "available", "for me", "are there", "any", "how many", "open", "near me")) {
    if (!f.marketLive) return `Your market is not open yet, so offers start the moment it opens. ${fmt(f.directInvites)} direct invites are on file for you, and finishing your profile is what puts you first in line on day one.`;
    if (!f.offersOpen) return "No open offers in your markets right now. New offers land in your Offers deck, and higher Momentum sees them earlier.";
    return linked(`${fmt(f.offersOpen)} open offers in your markets right now${f.directInvites ? `, including ${fmt(f.directInvites)} direct ${plural(f.directInvites, "invite")} sent to you` : ""}. They are in your Offers deck, newest first.`, "Open Offers", "cr-offers");
  }
  // Applications pending
  if (hasWord(t, "application", "applications") && hasPhrase(t, "my", "pending", "waiting", "applied", "how many")) {
    if (!f.applicationsPending) return "No applications of yours are waiting. When you apply to an offer, the business owes you an answer within 2 business days.";
    return linked(`${fmt(f.applicationsPending)} of your applications ${f.applicationsPending === 1 ? "is" : "are"} waiting on a business's answer. Every applicant gets an answer within 2 business days; that is the deal, and the app tracks it.`, "See my applications", "cr-offers-applied");
  }
  // Posts owed / visits
  if (hasPhrase(t, "do i owe", "posts owed", "owe a post", "still owe", "what do i owe") || (hasWord(t, "visit", "visits") && hasPhrase(t, "my", "booked", "coming", "do i have", "upcoming"))) {
    const owedBits = f.postsOwed.slice(0, 3).map((o) => `"${o.title}" at ${o.businessName}${o.overdue ? " (overdue now)" : ""}`).join("; ");
    const owedText = `You have ${fmt(f.visitsUpcoming)} ${plural(f.visitsUpcoming, "visit")} booked and coming up, and ${fmt(f.postsOwed.length)} ${plural(f.postsOwed.length, "post")} owed from visits already redeemed${f.postsOwed.length ? `: ${owedBits}` : ""}. A post inside 48 hours is on time; one week is the hard deadline.`;
    return (f.visitsUpcoming || f.postsOwed.length) ? linked(owedText, "Open My Visits", "cr-visits") : owedText;
  }
  // Licence requests waiting on me (Build -95): first asks and
  // renewals land in the same creator-approved flow, under
  // Earnings, with working Approve / Decline on each record.
  if (hasWord(t, "license", "licenses", "licence", "licences") && hasPhrase(t, "waiting", "pending", "request", "requests", "renew", "decide", "approve")) {
    if (!f.pendingLicenses || !f.pendingLicenses.length) return "No licence requests are waiting on you. When a business asks to license one of your posts, or to renew a licence that is ending, it lands under Earnings for your yes or no.";
    const list = f.pendingLicenses.map((l) => `${l.businessName} at your ${cmoney(f, l.fee)} fee${l.renewal ? " (a renewal: their current licence is ending)" : ""}`).join("; ");
    return linked(`${fmt(f.pendingLicenses.length)} licence ${plural(f.pendingLicenses.length, "request")} waiting on your decision: ${list}. Approving starts a fresh 90 days of repost and ad use that day, and you keep 97% of the fee. Declining leaves the post native share only.`, "Decide in Earnings", "cr-earnings");
  }
  // Earnings (recorded only, labeled)
  if (hasPhrase(t, "have i earned", "have i made", "my earnings", "much have i", "paid bookings", "money have i") || (hasWord(t, "earned", "earnings") && hasWord(t, "my", "i"))) {
    return linked(`Recorded: ${cmoney(f, f.paidRecordedNet)} net across ${fmt(f.paidBookings)} paid ${plural(f.paidBookings, "booking")} on file. Recorded means the bookings in the app; payouts run outside the app for now, and the app never promises a payout date.${f.intentTotal > 0 ? ` Your posts have drawn ${fmt(f.intentTotal)} saves and shares so far (intent: people planning to come).` : ""}${f.licenseRequestsPending ? ` Also waiting on you: ${fmt(f.licenseRequestsPending)} license ${plural(f.licenseRequestsPending, "request")} to approve or decline.` : ""}`, "Open Earnings", "cr-earnings");
  }
  // Profile state
  if (hasPhrase(t, "my profile", "am i finished", "am i complete", "profile finished", "profile complete", "businesses see me", "can businesses see") || (hasWord(t, "missing") && hasWord(t, "profile", "my"))) {
    if (f.profileComplete) return "Your profile is finished, so businesses can see you and book you. A finished profile is the gate, and you are through it.";
    return linked(`Your profile is not finished yet, so businesses cannot see you. Still missing: ${f.missingLabels.length ? f.missingLabels.join(", ") : "a last check on your Profile"}. Finishing it is the step that makes offers reachable.`, "Finish my profile", "cr-profile");
  }
  // Referrals
  if (hasPhrase(t, "my referrals", "my invites", "through my link", "through my invite", "joined through", "signed up through")) {
    return `${fmt(f.referrals.signups)} creators joined through your invite link, and ${fmt(f.referrals.approved)} of them were approved. Sign-ups earn +3 Momentum and approvals +10 more, with badge bonuses up the ladder.`;
  }
  // My rate / fee
  if (hasPhrase(t, "my rate", "my listed rate", "rate did i", "my license fee", "my licensing fee")) {
    if (!f.paidRate && !f.licenseFee) return linked(`No paid rate on your profile yet. Your rate is yours to set on your Profile, with a ${f.currencySymbol || "$"}${f.paidFloor || 50} floor for paid bookings.`, "Set my rates", "cr-profile");
    return linked(`Your listed paid rate is ${f.paidRate ? cmoney(f, f.paidRate) : "not set"}${f.licenseFee ? `, and your licensing fee is ${cmoney(f, f.licenseFee)}` : ""}. You keep 97% of both when they book or license through SIGNL.`, "Open my Profile", "cr-profile");
  }
  return null;
}

// ---------- DISPATCH ----------
// answerFactsRaw returns the string or the { text, link }
// object; answerFacts keeps the legacy plain-string contract
// (the router's linked path and older callers split here).
function answerFactsRaw(role, facts, question, history) {
  if (!facts || !question) return null;
  const t = normQ(question);
  let out = null;
  try {
    if (role === "admin") out = answerAdmin(facts, question, t);
    else if (role === "business") out = answerBusiness(facts, question, t);
    else if (role === "creator") out = answerCreator(facts, question, t);
  } catch (e) { out = null; }
  if (out) return out;
  // Fragment follow-up: "and in Nashville?" after a count
  // question re-runs that question scoped to the market (admin).
  if (role === "admin") {
    const toks = t.split(" ").filter(Boolean);
    const marketNames = [...new Set([...facts.creators.byMarket.map((m) => m.market), ...facts.markets.liveNames])];
    const market = findMarketIn(question, marketNames);
    if (market && toks.length <= 7 && Array.isArray(history)) {
      const prev = history.filter((h) => h && h.who === "user" && typeof h.text === "string").pop();
      if (prev && prev.text.trim() && prev.text.trim().toLowerCase() !== String(question).trim().toLowerCase()) {
        try { return answerAdmin(facts, `${prev.text} in ${market}`, normQ(`${prev.text} in ${market}`)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

// ---------------- SIG HOME STATE (Build -78) ----------------
// The greeting chips on the Sig tab home: the asker's own live
// state, stated in plain words, computed from the same fact
// sheet the answerer uses. Only true numbers ever appear: a
// chip with a zero behind it is simply not built, and the one
// standing-status chip (founding list / market live / profile
// state) carries no count at all. Admin gets no chips: the
// console Sig stays read-only answers, exactly as before.
function buildHomeState(role, f) {
  if (!f || role === "admin") return { chips: [] };
  const chips = [];
  if (role === "business") {
    // A founding business is on the founding list even in a
    // market that has opened: its own offers still run as
    // drafts until activation, so the founding chip wins.
    if (f.founding) chips.push(`Founding list${f.market ? " · " + f.market : ""}`);
    else if (f.marketLive) chips.push(`${f.market || "Your market"} is live`);
    if (f.applicantsWaiting) chips.push(`${fmt(f.applicantsWaiting)} ${plural(f.applicantsWaiting, "applicant")} waiting`);
    if (f.draftOffers) chips.push(`${fmt(f.draftOffers)} ${plural(f.draftOffers, "draft")} in progress`);
    if (f.offersLive) chips.push(`${fmt(f.offersLive)} ${plural(f.offersLive, "offer")} live`);
    if (f.visitsAllowance) chips.push(`${fmt(f.visitsRemaining)} ${plural(f.visitsRemaining, "visit")} left this month`);
    if (f.postsLive) chips.push(`${fmt(f.postsLive)} ${plural(f.postsLive, "post")} live`);
    if (f.rosterInMarket) chips.push(`${fmt(f.rosterInMarket)} ${plural(f.rosterInMarket, "creator")} on your ${f.market || "market"} roster`);
    // Build -95 proactive prompts: only when the record is
    // real. A licence inside its 14-day window, and Regulars
    // nobody has rebooked since their visit.
    if (f.licencesExpiring && f.licencesExpiring.length) chips.push(`${fmt(f.licencesExpiring.length)} ${plural(f.licencesExpiring.length, "licence")} ending soon`);
    const unbooked = (f.regulars || []).filter((r) => !r.rebookedSince).length;
    if (unbooked) chips.push(`${fmt(unbooked)} ${plural(unbooked, "Regular")} to book again`);
    // Build -96 proactive prompts, real records only: standing
    // availability unset on the business page, and a new
    // month's receipt ready to forward (the router only sets
    // receiptReady when that month holds real activity).
    if (!f.availabilitySet) chips.push("Set your standing hours");
    if (f.receiptReady) chips.push(`${f.receiptReady.monthLabel} receipt is ready to forward`);
    // Build -97 proactive prompts, real records only: a
    // founding business with no campaign drafts at all, a
    // draft an active business started and never finished,
    // and plan visits unused partway through the month.
    if (f.founding && !(f.offersTotal > 0)) chips.push("Set up your first campaign");
    if (f.unfinishedDrafts) chips.push("Finish your draft campaign");
    if (f.visitsUnusedMidMonth) chips.push(`${fmt(f.visitsUnusedMidMonth.remaining)} of ${fmt(f.visitsUnusedMidMonth.allowance)} visits unused this month`);
    // Build -99 proactive prompts, real records only: the
    // setup checklist's register item still undone (and
    // Square switched on for the account), and anything at
    // all left on the checklist. All done means silence.
    if (f.setup && !f.setup.allDone) {
      if (f.setup.square && f.setup.square.configured && f.setup.square.state === "not_connected") chips.push("Connect your Square register");
      if (f.setup.remaining.length) chips.push(`${fmt(f.setup.remaining.length)} ${plural(f.setup.remaining.length, "setup step")} left to set up`);
    }
  } else if (role === "creator") {
    if (f.directInvites) chips.push(`${fmt(f.directInvites)} ${plural(f.directInvites, "invite")} sent to you`);
    if (f.offersOpen) chips.push(`${fmt(f.offersOpen)} ${plural(f.offersOpen, "offer")} waiting`);
    if (f.postsOwed && f.postsOwed.length) chips.push(`${fmt(f.postsOwed.length)} ${plural(f.postsOwed.length, "post")} owed`);
    if (f.applicationsPending) chips.push(`${fmt(f.applicationsPending)} ${plural(f.applicationsPending, "application")} waiting on an answer`);
    if (f.licenseRequestsPending) chips.push(`${fmt(f.licenseRequestsPending)} license ${plural(f.licenseRequestsPending, "request")} waiting`);
    chips.push(`${fmt(f.momentumPoints)} Momentum points`);
    chips.push(f.profileComplete ? "Profile live" : (f.missingLabels && f.missingLabels.length ? `Profile: ${fmt(f.missingLabels.length)} ${plural(f.missingLabels.length, "step")} to finish` : "Profile not finished"));
    // Build -98 proactive prompts, real records only: payout
    // setup is owed while paid-lane activity or recorded
    // earnings exist and payouts are not ready; and a finished
    // profile with a blank paid rate gets the rate-card prompt.
    // A creator with neither fact true hears neither prompt.
    if (!f.payoutsReady && (f.paidBookings > 0 || f.paidRecordedNet > 0)) chips.push("Set up payouts");
    if (f.profileComplete && !f.paidRate) chips.push("Set your rate card");
    if (f.founding) chips.push(`Founding roster${f.market ? " · " + f.market : ""}`);
    else if (f.marketLive) chips.push(`${f.market || "Your market"} is live`);
    // Build -102: on a public roster page is real state worth
    // one quiet chip, with the page as its walk.
    if (f.publicRoster && f.publicRoster.length) chips.push(`You're on the public ${f.publicRoster[0].market} roster`);
  }
  return { chips };
}

function answerFacts(role, facts, question, history) {
  const out = answerFactsRaw(role, facts, question, history);
  if (!out) return null;
  return typeof out === "string" ? out : out.text;
}

module.exports = { buildAdminFacts, buildBusinessFacts, buildCreatorFacts, factsLines, answerFacts, answerFactsRaw, buildHomeState };
