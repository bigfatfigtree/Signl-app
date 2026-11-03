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
    id: u.id,
    name: (u.partner && u.partner.name) || u.name || "Partner",
    status: (u.partner && u.partner.status) || "active",
    markets: (u.partner && u.partner.markets) || [],
    demo: !!(u.partner && u.partner.demo),
    // Co-brand (Build -105): whether Admin has set a brand
    // block for this partner, and whether a logo is on file.
    brandSet: !!brandViewOf(u.partner && u.partner.brand),
    brandName: (brandViewOf(u.partner && u.partner.brand) || {}).displayName || "",
    hasLogo: !!(brandViewOf(u.partner && u.partner.brand) || {}).logoUrl,
    // Team seats (Build -107): the org's seat rollup with the
    // minter split (partner-invited vs SIGNL-invited).
    team: (d.teamByPartner || {})[u.id] || null,
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
    // Build -106: the London district race rollup (Admin and
    // the London partner only; never public).
    londonRace: d.londonRace || null,
    markets: { liveNames, liveCount: liveNames.length, known: (d.marketNames || []).length },
  };
}

// ---------------- PARTNER FACTS (Build -106) ----------------
// The scoped partner Sig's fact sheet: the partner's OWN
// records only, lifted from the same summary payload their
// dashboard renders, plus their frozen month packs, their
// scopes, and the London race when London is theirs. Nothing
// about any other partner exists in this sheet, so no answer
// built from it can leak across partners.
// deps: { user, summary, frozenMonths, race, now }
function buildPartnerFacts(d) {
  const s = d.summary || {};
  const p = s.partner || {};
  const e = s.earnings || {};
  const t = s.totals || {};
  const cs = (s.creators && s.creators.stages) || {};
  const bs = (s.businesses && s.businesses.stages) || {};
  return {
    role: "partner",
    name: p.name || "",
    demo: !!p.demo,
    markets: p.markets || [],
    brand: p.brand || null,
    territory: s.territory || [],
    scopes: s.scopes || [{ kind: "license" }],
    totals: {
      creatorsAttributed: t.creatorsAttributed || 0,
      businessesAttributed: t.businessesAttributed || 0,
      offersLive: t.offersLive || 0,
      visitsCompleted: t.visitsCompleted || 0,
      postsLive: t.postsLive || 0,
    },
    creatorStages: { claimed: cs.claimed || 0, approved: cs.approved || 0, complete: cs.complete || 0 },
    businessStages: { applied: bs.applied || 0, approved: bs.approved || 0, active: bs.active || 0 },
    earnings: {
      basis: e.basis || "share_only",
      currency: e.currency || "USD",
      sharePct: typeof e.sharePct === "number" ? e.sharePct : null,
      monthlyRevenue: e.monthlyRevenue || 0,
      accruedMonthly: e.accruedMonthly || 0,
      accruedTotal: e.accruedTotal || 0,
      paidTotal: e.paidTotal || 0,
      owedTotal: e.owedTotal || 0,
      guaranteeState: e.guaranteeState || null,
      dealLabel: e.dealLabel || "",
      byCurrency: e.byCurrency || null,
    },
    perMarket: (s.markets || []).map((m) => ({ market: m.market, creatorsClaimed: (m.creators || {}).claimed || 0, creatorsComplete: (m.creators || {}).complete || 0, businessesApplied: (m.businesses || {}).applied || 0, offersLive: m.offersLive || 0, postsLive: m.postsLive || 0 })),
    frozenMonths: Array.isArray(d.frozenMonths) ? d.frozenMonths : [],
    race: d.race || null,
    // Team seats (Build -107): a teamAdmin's seat list + the
    // scopes they may invite into; a member's membership fact.
    team: d.team || null,
  };
}

// ---------------- PILOT FACTS (Build -106) ----------------
// The funder's scoped Sig sheet: their one pilot's totals from
// the same builder the Impact Portal prints. Counted and
// recorded stay separate fields, never summed.
// deps: { user, pf, now }
function buildPilotFacts(d) {
  const pf = d.pf || {};
  const p = pf.pilot || {};
  const f = pf.fund || {};
  const c = pf.counts || {};
  return {
    role: "pilot_partner",
    pilotName: p.name || "",
    partnerName: p.partnerName || "",
    marketName: p.marketName || "",
    status: p.status || "active",
    closed: !!pf.closed,
    brand: p.brand || null,
    fund: { committedCents: f.committedCents || 0, spentCents: f.spentCents || 0, remainingCents: f.remainingCents || 0 },
    counts: {
      businesses: c.businesses || 0, visitsDone: c.visitsDone || 0, postsLive: c.postsLive || 0,
      countedCustomers: c.countedCustomers || 0, recordedCustomers: c.recordedCustomers || 0,
      continued: c.continued || 0,
    },
    continuedOnFounding: pf.continuedOnFounding || 0,
    // Team seats (Build -107): the funder lead's pilot seats.
    team: d.team || null,
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
    verifiedInMarketCount: d.verifiedInMarketCount || 0,
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
    // Build -108: Instagram audience verification, read from
    // the same record the profiles and ranking read. verified
    // markets carry withinTolerance entries; belowSelf lists
    // markets where Instagram's number landed materially under
    // the stated share (outside tolerance, on the low side).
    audienceVerification: (() => {
      const av = c.audienceVerification || null;
      const per = (av && av.perMarket) || {};
      const verifiedMarkets = Object.keys(per).filter((m) => per[m] && per[m].withinTolerance === true);
      const belowSelf = Object.keys(per).filter((m) => per[m] && per[m].withinTolerance !== true && typeof per[m].igPct === "number" && typeof per[m].selfPct === "number" && per[m].igPct < per[m].selfPct).map((m) => ({ market: m, igPct: per[m].igPct, selfPct: per[m].selfPct }));
      const stale = !!(av && av.status === "verified" && av.verifiedAt && Date.now() - Date.parse(av.verifiedAt) > 45 * 86400000);
      return {
        status: !av ? "self_reported" : (av.status === "verified" ? (stale ? "stale" : "verified") : "self_reported"),
        verifiedMarkets,
        belowSelf,
        perMarket: per,
        note: av ? av.note || null : null,
        verifiedAt: av ? av.verifiedAt || null : null,
        igConnected: !!((c.platformSync || {}).instagram),
        igConfigured: !!d.igConfigured,
      };
    })(),
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
    if (f.londonRace) {
      const r = f.londonRace;
      lines.push(`London district race: state ${r.state}${r.startsAt ? `, started ${String(r.startsAt).slice(0, 10)}, backstop ${String(r.endsAt || "").slice(0, 10)}` : ""}. Districts (approved founding creators / founding businesses, targets 40 and 15): ${r.districts.map((x) => `${x.name} ${x.creators}/${x.businesses} (score ${x.score})`).join("; ")}. Outside the race field: ${r.outsideField.creators} creators, ${r.outsideField.businesses} businesses. London totals: ${r.totals.creators} creators, ${r.totals.businesses} businesses.${r.winner ? ` Winner: ${(r.districts.find((x) => x.id === r.winner) || {}).name || r.winner}.` : ""}`);
    }
    const teamOrgs = f.partners.list.filter((p) => p.team && p.team.total > 0);
    if (teamOrgs.length) lines.push(`Partner team seats: ${teamOrgs.map((p) => `${p.name}: ${p.team.total} seats (${p.team.byPartner} invited by the partner's own team admin, ${p.team.byAdmin} invited by SIGNL): ${p.team.seats.map((s) => `${s.name} (${s.kind}, ${s.scope}, ${s.status})`).join("; ")}`).join(". ")}.`);
    return lines;
  }
  if (role === "partner") {
    const lines = [];
    const sym = f.earnings.currency === "GBP" ? "£" : "$";
    const mny = (n) => sym + (Math.round(n0(n) * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
    lines.push(`This partner is ${f.name || "a SIGNL partner"}${f.demo ? " (the demo partner; its records are samples)" : ""}. Their markets: ${f.markets.join(", ") || "none yet"}. Everything in this sheet is their own record only.`);
    lines.push(`Their funnel: ${fmt(f.creatorStages.claimed)} creators claimed (${fmt(f.creatorStages.approved)} approved, ${fmt(f.creatorStages.complete)} complete), ${fmt(f.businessStages.applied)} businesses joined (${fmt(f.businessStages.active)} active), ${fmt(f.totals.offersLive)} offers live, ${fmt(f.totals.visitsCompleted)} visits completed, ${fmt(f.totals.postsLive)} posts live.`);
    lines.push(`Their earnings (${f.earnings.basis === "deal" ? `deal basis${f.earnings.dealLabel ? `, "${f.earnings.dealLabel}"` : ""}` : "share-only basis"}, ${f.earnings.currency}): share ${f.earnings.sharePct === null ? "not set" : f.earnings.sharePct + "%"}, subscription revenue on file ${mny(f.earnings.monthlyRevenue)} a month, accrued ${mny(f.earnings.accruedTotal)} in total (${mny(f.earnings.accruedMonthly)} this month), paid ${mny(f.earnings.paidTotal)}, owed ${mny(f.earnings.owedTotal)}. Accrued means earned on paper; it is paid only when a payment is recorded.${f.earnings.guaranteeState ? ` Guarantee: ${f.earnings.guaranteeState}.` : ""}`);
    if (f.territory.length) lines.push(`Territory they hold: ${f.territory.map((x) => `${x.market} (${x.attributionScope === "sourced_only" ? "only businesses they brought in count" : "the whole market counts"}, exclusivity ${x.exclusivity === "market_conditional" ? "conditional" : "none"})`).join("; ")}.`);
    lines.push(f.brand ? `Their portal is co-branded as ${f.brand.displayName || "their own name"}${f.brand.logoUrl ? ", with their logo" : ", no logo on file"}, with Powered by SIGNL underneath. Branding is set by the SIGNL team, not by the partner.` : "Their portal carries SIGNL branding only; no co-brand is set. Branding is set by the SIGNL team, not by the partner.");
    lines.push(f.frozenMonths.length ? `Frozen month packs ready to download: ${f.frozenMonths.map((m) => m.label).join(", ")}. The newest is ${f.frozenMonths[0].label}; the pack lives on their Earnings view.` : "No month has been frozen for them yet, so no final pack exists; an open month can still be downloaded as a live snapshot from Earnings.");
    if (f.scopes.length > 1) lines.push(`Their login carries ${fmt(f.scopes.length)} scopes: the license view plus ${f.scopes.filter((s) => s.kind === "pilot").map((s) => `the ${s.name || "pilot"} Impact Portal`).join(", ")}. Each scope's numbers stay on their own lines and are never added together.`);
    if (f.race) lines.push(`London district race (their market): state ${f.race.state}. Districts (creators / businesses, targets 40 / 15): ${f.race.districts.map((x) => `${x.name} ${x.creators}/${x.businesses}`).join("; ")}.`);
    if (f.team && f.team.isAdmin) lines.push(`They are their org's team admin. Their team seats: ${f.team.seats.length ? f.team.seats.map((s) => `${s.name} (${s.kind} seat, ${s.scope}, ${s.status})`).join("; ") : "none yet"}. They can invite into their own scopes only: ${f.team.markets && f.team.markets.length ? `recruiters in ${f.team.markets.join(", ")}; ` : ""}${(f.team.pilots || []).length ? `pilot seats on ${(f.team.pilots || []).map((p) => p.name).join(", ")}; ` : ""}and partner team seats. Invites and revokes happen in this chat by a confirm button, or on the Team view.`);
    if (f.team && f.team.isMember) lines.push(`They are a team member of ${f.team.orgName || "their partner org"}: they see the org's numbers without the deal terms, and their org's lead manages the team seats.`);
    return lines;
  }
  if (role === "pilot_partner") {
    const lines = [];
    const dm = (cents) => "$" + (Math.round(n0(cents)) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
    lines.push(`This funder is ${f.partnerName || "a pilot funder"}; their pilot is "${f.pilotName}" in ${f.marketName}. The pilot is ${f.closed ? "CLOSED: the numbers are the final record" : "active"}. Everything in this sheet is their own pilot only.`);
    lines.push(`The fund: ${dm(f.fund.committedCents)} put in, ${dm(f.fund.spentCents)} spent, ${dm(f.fund.remainingCents)} left. Results: ${fmt(f.counts.businesses)} businesses chosen, ${fmt(f.counts.visitsDone)} visits done, ${fmt(f.counts.postsLive)} posts live.`);
    lines.push(`Customers: ${fmt(f.counts.countedCustomers)} counted at the register and ${fmt(f.counts.recordedCustomers)} recorded by the businesses. These are two different counts and are never added together.`);
    lines.push(`${fmt(f.counts.continued)} businesses joined SIGNL afterwards${f.counts.continued ? `, ${fmt(f.continuedOnFounding)} of them on the $199 founding rate (from their own plan records)` : ""}.${f.closed ? " Their end-of-pilot pack is ready on the Report view." : ""}`);
    if (f.team && f.team.isAdmin) lines.push(`They are the pilot's team admin. Their pilot team seats: ${f.team.seats.length ? f.team.seats.map((s) => `${s.name} (${s.scope}, ${s.status})`).join("; ") : "none yet"}. They can invite people onto this pilot and revoke those seats, in this chat by a confirm button or on the Team view.`);
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
  const avLine = f.audienceVerification || {};
  lines.push(avLine.igConnected
    ? `Instagram audience verification: status ${avLine.status}${avLine.verifiedMarkets && avLine.verifiedMarkets.length ? `, verified in ${avLine.verifiedMarkets.join(", ")} (Instagram city data within 10 points of the stated share)` : ""}${avLine.belowSelf && avLine.belowSelf.length ? `; Instagram shows lower in ${avLine.belowSelf.map((b) => `${b.market} (${b.igPct}% vs stated ${b.selfPct}%)`).join(", ")}` : ""}${avLine.note ? `; note: ${avLine.note}` : ""}.`
    : "Instagram audience verification: not connected, so their local shares are self-reported.");
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
  if (hasPhrase(t, "which till", "what till", "tills", "pos mix", "register systems", "point of sale", "what pos", "clover", "toast", "lightspeed") || (hasPhrase(t, " pos ", " pos?") && countAsk)) {
    const m = b.posMix || {};
    const declared = (m.square || 0) + (m.clover || 0) + (m.toast || 0) + (m.lightspeed || 0) + (m.other || 0) + (m.none || 0);
    return linked(`Declared tills across ${fmt(b.total)} real ${plural(b.total, "business", "businesses")}: Square ${fmt(m.square || 0)}, Clover ${fmt(m.clover || 0)}, Toast ${fmt(m.toast || 0)}, Lightspeed ${fmt(m.lightspeed || 0)}, another system ${fmt(m.other || 0)}, no register system ${fmt(m.none || 0)}, and ${fmt(m.undeclared || 0)} have not declared yet. ${declared} ${plural(declared, "declaration")} on file; the Clover build trigger is 10 to 20 declared businesses. The mix strip sits on the Command Center Businesses view.`, "Open Businesses", "admin-businesses");
  }

  // London district race (Build -106): the rollup, Admin-side.
  // Asked before the London money intent so "race" questions
  // never land on prices.
  if (hasWord(t, "race") && (hasWord(t, "london", "district", "districts") || hasPhrase(t, "winning", "who is winning", "leader", "standings"))) {
    const r = f.londonRace;
    if (!r) return "The London race rollup is not available right now.";
    if (r.state === "not_started") return `The London district race has not started: no start date is set, so there is no clock and no winner. Raw counts today: ${r.districts.map((x) => `${x.name} ${x.creators} creators / ${x.businesses} businesses`).join("; ")}; outside the race field ${r.outsideField.creators} creators and ${r.outsideField.businesses} businesses. Set the start date on the Markets view when the London partner launches it.`;
    const lead = r.districts.slice().sort((a, b) => b.score - a.score)[0];
    if (r.state === "won") { const w = r.districts.find((x) => x.id === r.winner) || lead; return linked(`${w.name} has won the London district race: ${w.creators} approved founding creators and ${w.businesses} founding businesses, past both targets (40 and 15).`, "Open the race board", "admin-markets"); }
    if (r.state === "backstop_scored") { const w = r.districts.find((x) => x.id === r.winner) || lead; return linked(`The London race hit its 8-week backstop and the score decided it: ${w.name}, ${w.creators} creators and ${w.businesses} businesses, score ${w.score} (creators count 1, businesses count 2). No district reached both targets.`, "Open the race board", "admin-markets"); }
    return linked(`The London race is running (started ${String(r.startsAt || "").slice(0, 10)}, backstop ${String(r.endsAt || "").slice(0, 10)}). ${lead.name} leads on score ${lead.score}: ${lead.creators} creators, ${lead.businesses} businesses. Board: ${r.districts.map((x) => `${x.name} ${x.creators}/${x.businesses} (score ${x.score})`).join("; ")}. First to 40 creators AND 15 businesses wins outright.`, "Open the race board", "admin-markets");
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

  // Team seats (Build -107): any org's seats and who minted
  // them — the rollup Admin keeps without being the bottleneck.
  if (hasWord(t, "team", "seat", "seats") && !hasWord(t, "recruiter", "recruiters")) {
    const orgs = (f.partners.list || []).filter((p) => p.team && p.team.total > 0);
    if (!orgs.length) return "No partner team seats yet. Partners seat their own people once SIGNL names a team admin on the partner record; every seat so far is a login SIGNL created.";
    const named = orgs.find((p) => p.name && q.toLowerCase().includes(p.name.toLowerCase()));
    const show = named ? [named] : orgs;
    return linked(`${show.map((p) => `${p.name}: ${p.team.total} seats (${p.team.byPartner} invited by the partner's team admin, ${p.team.byAdmin} invited by SIGNL): ${p.team.seats.filter((s) => s.status !== "revoked").map((s) => `${s.name} (${s.kind}, ${s.scope}, ${s.status}, ${s.mintedBy === "partner" ? "partner-invited" : "SIGNL-invited"})`).join("; ")}`).join(". ")}. The full rollup sits on each partner's Admin detail.`, "Open Partners", "admin-partners");
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
    // "Who owns X" means the territory holder: a market-wide
    // deal outranks a sourced-only one sharing the market
    // (Build -107: list order alone made this answer flip
    // between two live deals in one market).
    const inMarket = (f.deals || []).filter((x) => (x.status === "signed" || x.status === "live") && (x.liveMarkets || []).some((m) => m.toLowerCase() === askedKey));
    const holder = inMarket.find((x) => x.attributionScope !== "sourced_only" && x.exclusivity === "market_conditional") || inMarket.find((x) => x.attributionScope !== "sourced_only") || inMarket[0];
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
  // London ad label (Phase B, Build -111): a London visit whose
  // post is live but not delivered is almost always this
  // blocker. The fix is the creator's, on their visit card;
  // the business is told that plainly instead of being left
  // to chase it.
  if (hasPhrase(t, "ad label", "adlabel") || hasPhrase(t, "#ad")) {
    return linked("UK rules count a comped or paid London post as an ad, so the post must carry #ad up front. A London post whose caption did not carry it is blocked as Ad label missing and does not count as delivered yet, and on a paid booking the money stays held behind the same blocker. The creator fixes it on their own visit card by confirming the caption; there is nothing for you to do, and the visit counts as delivered the moment the label is verified.", "Open the visit", "biz-visits");
  }
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
    const rosterText = `${fmt(f.rosterInMarket)} ${plural(f.rosterInMarket, "creator")} with finished profiles on the roster in ${f.market || "your market"} right now. ${f.founding ? "Booking opens when your market activates, and that finished roster is who you meet on day one." : "They are ranked by local reach in Find creators, and you can invite any of them at their listed rate."}${f.verifiedInMarketCount > 0 ? ` ${fmt(f.verifiedInMarketCount)} of them ${f.verifiedInMarketCount === 1 ? "carries" : "carry"} the Verified mark: Instagram confirmed their local share, and on an exact tie a verified creator ranks first.` : ""}`;
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
  // Included licence + extension (Phase A, Build -110): the
  // standard licence on a paid booking is automatic, never a
  // form or an add-on; extending past it is the one separate,
  // creator-approved path.
  if ((hasWord(t, "license", "licenses", "licence", "licences")) && hasPhrase(t, "extend", "separately", "included", "add-on", "addon", "extra charge", "form")) {
    return linked("A paid booking's standard licence is included and automatic: one dated record, repost and paid ad use for 90 days from the post date, never longer. Nobody fills in a licence form for it and it is never an add-on. To keep using a post beyond those 90 days, use Extend or license separately on the post in Posts and licenses: the request goes to the creator at their listed licensing fee, and a fresh 90 days starts only if they approve. Extending opens 14 days before the included licence ends.", "Open Posts and licenses", "biz-content");
  }
  // Licences ending soon (Build -95)
  if ((hasWord(t, "license", "licenses", "licence", "licences")) && hasPhrase(t, "expir", "ending", "ends", "renew", "extend", "run out", "running out")) {
    if (!f.licencesExpiring || !f.licencesExpiring.length) return linked("No licences are ending in the next 14 days. Every licence you hold shows its end date in Posts and licenses, and you get an alert 14 days and again 1 day before one ends.", "Open Posts and licenses", "biz-content");
    const list = f.licencesExpiring.map((l) => `${l.creatorName || "A creator"}'s post "${l.title}" ends ${l.endsOn}${l.ended ? " (already ended)" : ` (${fmt(Math.max(0, l.daysLeft))} ${plural(Math.max(0, l.daysLeft), "day")} left)`}`).join("; ");
    return linked(`Ending soon: ${list}. Ask to renew from Posts and licenses (Extend or license separately on the post): the request goes to the creator at their listed fee, and a fresh 90 days starts only if they approve. Nothing renews on its own.`, "Ask to renew", "biz-content");
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
  // London ad label (Phase B, Build -111): the blocker the
  // server names "ad label missing" now has its fix on the
  // visit card; Sig states the rule and walks the creator
  // straight to the Done segment where that card lives.
  if (hasPhrase(t, "ad label", "adlabel") || hasPhrase(t, "#ad")) {
    return linked("UK rules count a comped or paid London post as an ad, so the post must carry #ad up front. If the caption you submitted did not carry it, the visit is blocked as Ad label missing and does not count as delivered yet. The fix is on the visit card itself: open Visits, find the visit under Done, check the caption box (it starts with your disclosure line), and tap Confirm the ad label. The visit counts as delivered the moment the label is verified.", "Fix it on my visit card", "cr-visits-done");
  }
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
    // UK variant (Build -109, item 20): a creator in a GBP
    // market gets the UK explainer's words and never hears
    // about Form 1099-K; a US creator never hears sort codes.
    if (f.currencyCode === "GBP") {
      return linked(`Payout setup runs on Stripe's secure pages, from the paid lane on your Profile. Stripe will ask for identity details, because payment companies have to check who money is going to. It will ask for your address, as part of that check, and a UK bank account, your sort code and account number, so money can go to your bank by Faster Payments; bank details go to Stripe, never to SIGNL. Whether you sign up as a sole trader or through a limited company changes what Stripe asks for: a sole trader uses their own identity details; a limited company also gives the company's details and a director's. You are responsible for your own UK tax position, and SIGNL does not withhold tax from your earnings. Your first payout can be held briefly while identity checks clear. Paid bookings are recorded in the app and settled with help until the payout rail fully opens, so setup promises no payout date. ${stateLine}`, "Set up payouts on my Profile", "cr-profile");
    }
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
  // Instagram verification (Build -108, item 12): connect start,
  // per-market state, and the plain-words explainer.
  if (hasPhrase(t, "connect my instagram", "connect instagram", "link my instagram", "link instagram") && !hasPhrase(t, "disconnect")) {
    const av = f.audienceVerification || {};
    if (av.igConnected) return linked("Your Instagram is already connected. Your local shares are checked against it on every sync, and Sync now on your Profile re-checks them today.", "Open my Profile", "cr-profile");
    if (!av.igConfigured) return "Instagram connect is still in review with Meta, so it is not open yet. Your local shares stay self-reported until it clears, and the connect button appears on your Profile the day it does.";
    return linked("Connecting Instagram lets SIGNL check your local audience shares against Instagram's own city data. Markets that match within 10 points earn the Verified mark. The connect button is in the audience stack on your Profile.", "Connect Instagram on my Profile", "cr-profile");
  }
  if (hasPhrase(t, "verified", "verification") && hasPhrase(t, "local", "audience", "share", "instagram", "mean", "work")) {
    const av = f.audienceVerification || {};
    if (hasPhrase(t, "what does verified mean", "what is verified", "what does the verified", "how does verification work", "how is it verified")) {
      return "Verified means Instagram's own city data agrees with the local share on your profile, within 10 points, for that market. Your stated number never changes; Verified is a mark next to it, and when two creators score the same, the verified one ranks first. Connect Instagram on your Profile to be checked.";
    }
    if (!av.igConnected) return av.igConfigured
      ? linked("Not yet: your local shares are self-reported, typed by you and not checked. Connect Instagram on your Profile and Instagram's city data does the checking.", "Open my Profile", "cr-profile")
      : "Not yet: your local shares are self-reported, typed by you and not checked. Instagram connect is in review with Meta; it opens on your Profile the day it clears.";
    if (av.status === "verified") return `Verified in ${av.verifiedMarkets.join(", ")}: Instagram's city data matches your stated share there within 10 points.${av.belowSelf && av.belowSelf.length ? ` Heads up: in ${av.belowSelf.map((b) => `${b.market}, Instagram shows ${b.igPct}% against your stated ${b.selfPct}%`).join("; ")}. Updating your stated share keeps your profile honest.` : ""}`;
    if (av.note === "below_100") return "Instagram has not shared city data for your account: accounts under 100 followers do not get city data from Meta, so your shares stay self-reported for now. Your follower count itself is synced.";
    if (av.note === "no_city_data") return "Instagram has not shared city data yet (it can lag about 48 hours, and new connections start empty). Your shares stay self-reported until it lands; Sync now on your Profile re-checks.";
    return `Checked, and no market matched within 10 points yet, so your shares stay labeled self-reported.${av.belowSelf && av.belowSelf.length ? ` In ${av.belowSelf.map((b) => `${b.market} Instagram shows ${b.igPct}% against your stated ${b.selfPct}%`).join("; ")}.` : ""} Your stated numbers never change on their own; if Instagram's are closer to the truth, updating them is what earns the mark.`;
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

// ---------- PARTNER + PILOT ANSWERERS (Build -106) ----------
// Scoped to the asker's own fact sheet by construction: the
// sheet holds nothing about anyone else.
// ---------------- TEAM SEAT INTENTS (Build -107) ----------
// Shared by the partner and funder answers. Invites and
// revokes are confirm-first ACTIONS: the answer parses and
// proposes, the person taps the button, and the team endpoints
// re-check every fence before anything happens.
function teamSeatListText(team) {
  const seats = (team.seats || []).filter((s) => s.status !== "revoked");
  if (!seats.length) return "No team seats yet. Say \"invite\" with a name and email and I will line up the invite for your OK.";
  return `Your team seats: ${seats.map((s) => `${s.name} (${s.kind === "team" ? "partner team seat" : s.kind === "pilot" ? `pilot seat on ${s.scope}` : s.scope}, ${s.status})`).join("; ")}.`;
}
function titleCaseName(s) {
  return String(s || "").replace(/\s+/g, " ").trim().split(" ").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ").slice(0, 60);
}
function parseSeatInvite(f, question, isFunder) {
  const raw = String(question || "");
  const emailM = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (!emailM) return null;
  const email = emailM[0].toLowerCase();
  const before = raw.slice(0, raw.toLowerCase().indexOf(email)).replace(/\b(invite|add|send|to|my|team|seat|seats|please|on|the|a|an|as|for)\b/gi, " ").replace(/[^a-zA-Z .'-]/g, " ");
  const name = titleCaseName(before) || titleCaseName(email.split("@")[0].replace(/[._-]+/g, " "));
  const team = f.team;
  if (isFunder) {
    const pilot = (team.pilots || [])[0];
    if (!pilot) return { text: "Your pilot is not on file yet, so there is nothing to seat anyone on." };
    return { text: `Ready to invite ${name} (${email}) as a pilot seat on ${pilot.name}. They set their own password from the emailed link; nobody sees it but them. Tap the button and the invite goes out.`, action: { type: "team_invite", label: `Send the invite to ${email}`, payload: { kind: "pilot", name, email, pilotId: pilot.pilotId } } };
  }
  if (/recruiter/.test(raw)) {
    const markets = team.markets || [];
    const named = markets.find((m) => raw.toLowerCase().includes(m.toLowerCase()));
    const market = named || (markets.length === 1 ? markets[0] : null);
    if (!market) return { text: `Which of your markets should the recruiter sit in? Yours are ${markets.join(", ") || "none on file"}. Name one and I will line the invite up.` };
    return { text: `Ready to invite ${name} (${email}) as a recruiter for ${market}. They get their own recruiter login for that market only, and their outreach credits to them under your org. Tap the button and the invite goes out.`, action: { type: "team_invite", label: `Send the invite to ${email}`, payload: { kind: "recruiter", name, email, market } } };
  }
  if (/pilot/.test(raw) || (team.pilots || []).some((p) => p.name && raw.toLowerCase().includes(p.name.toLowerCase()))) {
    const pilots = team.pilots || [];
    const named = pilots.find((p) => p.name && raw.toLowerCase().includes(p.name.toLowerCase()));
    const pilot = named || (pilots.length === 1 ? pilots[0] : null);
    if (!pilot) return { text: `Which pilot should the seat be on? Your login carries ${(pilots.map((p) => p.name)).join(", ") || "none"}. Name one and I will line the invite up.` };
    return { text: `Ready to invite ${name} (${email}) as a pilot seat on ${pilot.name}. They set their own password from the emailed link. Tap the button and the invite goes out.`, action: { type: "team_invite", label: `Send the invite to ${email}`, payload: { kind: "pilot", name, email, pilotId: pilot.pilotId } } };
  }
  return { text: `Ready to invite ${name} (${email}) as a partner team seat. They will see ${f.name || "your org"}'s numbers and links, never the deal terms, and they manage nothing. They set their own password from the emailed link. Tap the button and the invite goes out.`, action: { type: "team_invite", label: `Send the invite to ${email}`, payload: { kind: "team", name, email } } };
}
function teamIntentAnswer(f, question, t, isFunder) {
  if (!f.team) return null;
  if (f.team.isMember) {
    if (hasWord(t, "team", "seat", "seats", "invite", "revoke")) return { text: `You are a team member of ${f.team.orgName || "your partner org"}: seats are managed by your org's partner lead. You see the org's numbers here; the deal terms stay with the lead.` };
    return null;
  }
  if (!f.team.isAdmin) {
    if (hasWord(t, "team", "seat", "seats", "invite", "revoke")) return { text: "Team seats open when SIGNL names you your org's team admin. Once that is set, you can invite people into your own markets and pilots from here or the Team view, and revoke them the same way." };
    return null;
  }
  const raw = String(question || "");
  if (hasWord(t, "revoke", "remove") && !/@/.test(raw)) {
    const seats = (f.team.seats || []).filter((s) => s.status !== "revoked");
    const hit = seats.find((s) => (s.name && raw.toLowerCase().includes(s.name.toLowerCase())) || (s.name && raw.toLowerCase().includes(s.name.toLowerCase().split(" ")[0])) || (s.email && raw.toLowerCase().includes(s.email.toLowerCase())));
    if (hit) return { text: `Ready to revoke ${hit.name}'s seat (${hit.scope}). Their access ends on their next request; everything they brought in stays credited. Tap the button to do it.`, action: { type: "team_revoke", label: `Revoke ${hit.name}'s seat`, payload: { seatId: hit.seatId } } };
    return { text: `${teamSeatListText(f.team)} Name the person and I will line up the revoke for your OK.` };
  }
  if ((hasWord(t, "invite", "add") || /@/.test(raw)) && /@/.test(raw)) {
    const parsed = parseSeatInvite(f, raw, isFunder);
    if (parsed) return parsed;
  }
  if (hasWord(t, "team", "seat", "seats", "invite", "invited", "revoke")) {
    return linked(`${teamSeatListText(f.team)} Invites go out from here: say invite with a name and email (add "recruiter" plus a market, or a pilot name, to pick the seat kind).`, "Open the Team view", "partner-team");
  }
  return null;
}

function answerPartner(f, question, t) {
  const sym = f.earnings.currency === "GBP" ? "£" : "$";
  const mny = (n) => sym + (Math.round(n0(n) * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  // Team seats (Build -107): list, invite, revoke.
  const teamAnswer = teamIntentAnswer(f, question, t, false);
  if (teamAnswer) return teamAnswer;
  // Month pack: produce it (the answer carries the walk to the
  // download on Earnings, which serves the frozen figures).
  if (hasWord(t, "pack", "export", "download", "spreadsheet") || (hasWord(t, "month", "monthly", "close", "closed") && hasWord(t, "numbers", "figures", "report", "final"))) {
    if (f.frozenMonths.length) {
      const newest = f.frozenMonths[0];
      return linked(`${newest.label} is frozen: your pack for that month is final and matches the numbers SIGNL closed with. ${f.frozenMonths.length > 1 ? `Also frozen: ${f.frozenMonths.slice(1, 4).map((m) => m.label).join(", ")}. ` : ""}Download it from Earnings: pick the month and tap Download the month pack.`, "Get the pack on Earnings", "partner-earnings");
    }
    return linked("No month has been frozen for you yet, so there is no final pack. You can still download any open month from Earnings as a live snapshot; it is labeled as one, and it can move until the month closes.", "Open Earnings", "partner-earnings");
  }
  // London race (only present in the sheet when London is theirs).
  if (hasWord(t, "race") && f.race) {
    const r = f.race;
    if (r.state === "not_started") return `The London district race has not started yet, so there is no winner and no clock running. On today's records: ${r.districts.map((x) => `${x.name} has ${x.creators} approved founding creators and ${x.businesses} founding businesses`).join("; ")}. The targets are 40 creators and 15 businesses a district.`;
    const lead = r.districts.slice().sort((a, b) => b.score - a.score)[0];
    if (r.state === "won") { const w = r.districts.find((x) => x.id === r.winner) || lead; return `${w.name} has won the London district race: ${w.creators} approved founding creators and ${w.businesses} founding businesses, past both targets (40 and 15).`; }
    if (r.state === "backstop_scored") { const w = r.districts.find((x) => x.id === r.winner) || lead; return `The 8 weeks ran out, so the backstop score decided it: ${w.name} leads with ${w.creators} creators and ${w.businesses} businesses (score ${w.score}: creators count 1, businesses count 2). No district reached both targets in time.`; }
    return `The London race is running (started ${String(r.startsAt || "").slice(0, 10)}, backstop ${String(r.endsAt || "").slice(0, 10)}). ${lead.name} leads on score: ${lead.creators} approved founding creators and ${lead.businesses} founding businesses (score ${lead.score}). First district to 40 creators AND 15 businesses wins outright. Full board: ${r.districts.map((x) => `${x.name} ${x.creators}/${x.businesses}`).join("; ")}.`;
  }
  if (hasWord(t, "race")) return "The London district race is not part of your markets, so it does not appear in your numbers. It belongs to the London partner's view and to Admin.";
  // Earnings.
  if (hasWord(t, "earn", "earnings", "accrued", "accrue", "owed", "paid", "share", "revenue", "money")) {
    const e = f.earnings;
    if (!e.accruedTotal && !e.monthlyRevenue) return `Nothing has accrued yet: no business in your markets has a paid subscription on file. The moment one does, it accrues here at your ${e.sharePct === null ? "recorded" : e.sharePct + "%"} share and shows on Earnings, labeled accrued until a payment actually happens.`;
    return linked(`You have accrued ${mny(e.accruedTotal)} in total (${mny(e.accruedMonthly)} this month) from ${mny(e.monthlyRevenue)} a month of subscription revenue on file. Paid to date: ${mny(e.paidTotal)}; owed to you: ${mny(e.owedTotal)}. Accrued means earned on paper from the records; it becomes paid only when a payment is recorded.${e.guaranteeState ? ` Right now: ${e.guaranteeState.toLowerCase()}.` : ""}`, "See Earnings", "partner-earnings");
  }
  // Territory (Build -104 truth, partner side).
  if (hasWord(t, "territory", "exclusive", "exclusivity") || hasPhrase(t, "my market", "whole market")) {
    if (!f.territory.length) return "No signed deal holds territory for you yet, so sign-ups count toward you only when they arrive through your links. Territory starts when a deal with live markets is signed.";
    return f.territory.map((x) => `${x.market}: ${x.attributionScope === "sourced_only" ? "only businesses you brought in count toward this deal, and sign-ups are not stamped to you automatically" : "the whole market counts toward this deal, and new sign-ups there are stamped to you automatically"}. Exclusivity: ${x.exclusivity === "market_conditional" ? "conditional, so a second signed deal or pilot in this market is blocked unless the recorded override path is used" : "none recorded"}.`).join(" ");
  }
  // Brand / how the portal looks (Build -105's partner-side gate).
  if (hasWord(t, "brand", "branding", "logo") || hasPhrase(t, "how does my portal look", "what does my portal look", "how my portal looks")) {
    if (!f.brand) return "Your portal runs on SIGNL branding only: no co-brand is set for you. When the SIGNL team sets one, your name and logo lead your portal and your invite emails, with Powered by SIGNL underneath. It is set by the SIGNL team; there is nothing you need to upload.";
    return `Your portal is co-branded: ${f.brand.displayName ? `it leads with ${f.brand.displayName}` : "it leads with your logo"}${f.brand.logoUrl ? " and your logo" : " (no logo on file yet)"}, and Powered by SIGNL sits underneath. Your invite emails carry ${f.brand.emailFromName || f.brand.displayName || "your name"} as the sender name. Branding changes are made by the SIGNL team.`;
  }
  // Scopes.
  if (hasWord(t, "scope", "scopes", "pilot", "pilots") || hasPhrase(t, "impact portal")) {
    const pilots = f.scopes.filter((s) => s.kind === "pilot");
    if (!pilots.length) return "Your login carries one scope: your license view, this dashboard. If you also fund a pilot, the SIGNL team can attach it to this same login and it appears here as its own view; you never need a second login.";
    return `Your login carries ${fmt(f.scopes.length)} scopes: this license view, plus ${pilots.map((s) => `the ${s.name || "pilot"} Impact Portal (${s.marketName || "its market"})`).join(" and ")}. Switch from the scopes card on your Home: each scope keeps its own numbers, and nothing is ever added across scopes.`;
  }
  // Funnel / standing.
  if (hasWord(t, "creators", "businesses", "funnel", "standing", "stand", "numbers", "claimed", "bench")) {
    if (!f.totals.creatorsAttributed && !f.totals.businessesAttributed) return linked("Your funnel fills in here: no creator or business has come through your links yet. Share your creator claim link and the first claim lands on this page the same day.", "Get your links", "partner-links");
    return linked(`Through your links so far: ${fmt(f.creatorStages.claimed)} creators claimed (${fmt(f.creatorStages.approved)} approved, ${fmt(f.creatorStages.complete)} complete), ${fmt(f.businessStages.applied)} businesses joined (${fmt(f.businessStages.active)} active). ${fmt(f.totals.offersLive)} offers live, ${fmt(f.totals.visitsCompleted)} visits completed, ${fmt(f.totals.postsLive)} posts live.${f.perMarket.length > 1 ? ` By market: ${f.perMarket.map((m) => `${m.market}: ${m.creatorsClaimed} claimed, ${m.businessesApplied} businesses`).join("; ")}.` : ""}`, "See your markets", "partner-markets");
  }
  return null;
}

function answerPilot(f, question, t) {
  // Team seats (Build -107): the funder lead's pilot seats.
  const teamAnswer = teamIntentAnswer(f, question, t, true);
  if (teamAnswer) return teamAnswer;
  const dm = (cents) => "$" + (Math.round(n0(cents)) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (hasWord(t, "pack", "export", "download", "report", "board")) {
    return linked(`${f.closed ? "Your pilot has wrapped up, so the end-of-pilot pack is the final record: " : "The pack is ready any time from the Report view: "}fund totals, every business's step, and the customer counts with counted and recorded kept separate. Download it from Report.`, "Open the Report", "pilot-report");
  }
  if (hasWord(t, "counted", "recorded", "customers", "register")) {
    return `${fmt(f.counts.countedCustomers)} customers were counted at the register (they used the creator's code at the till, so they sit on the businesses' own register records) and ${fmt(f.counts.recordedCustomers)} were recorded by the businesses themselves. The two are different counts and are never added together.`;
  }
  if (hasWord(t, "fund", "spent", "spend", "left", "money", "cost")) {
    return `The fund: ${dm(f.fund.committedCents)} put in, ${dm(f.fund.spentCents)} spent so far, ${dm(f.fund.remainingCents)} left. It pays only for the first creator visit at each chosen business, at the creator's own listed rate.`;
  }
  if (hasWord(t, "joined", "continued", "conversion", "afterwards", "signed up")) {
    if (!f.counts.continued) return "No business has joined SIGNL on its own plan after its pilot visit yet. When one does, it shows here and on the Report, counted from its own plan record.";
    return `${fmt(f.counts.continued)} businesses joined SIGNL after their pilot visit${f.counts.continued ? `, and ${fmt(f.continuedOnFounding)} of them are on the $199 founding rate, read from their own plan records` : ""}.`;
  }
  if (hasWord(t, "brand", "branding", "logo") || hasPhrase(t, "how does my portal look", "what does my portal look")) {
    if (!f.brand) return "Your portal runs on SIGNL branding only: no co-brand is set for your pilot. When the SIGNL team sets one, your name and logo lead the portal and your invite emails, with Powered by SIGNL underneath.";
    return `Your portal is co-branded: it leads with ${f.brand.displayName || "your name"}${f.brand.logoUrl ? " and your logo" : " (no logo on file yet)"}, with Powered by SIGNL underneath. Your invite emails carry ${f.brand.emailFromName || f.brand.displayName || "your name"} as the sender name.`;
  }
  if (hasWord(t, "businesses", "visits", "posts", "results", "standing", "stand", "numbers")) {
    return `${fmt(f.counts.businesses)} businesses chosen, ${fmt(f.counts.visitsDone)} visits done, ${fmt(f.counts.postsLive)} posts live. ${fmt(f.counts.countedCustomers)} customers counted at the register, ${fmt(f.counts.recordedCustomers)} recorded by the businesses (separate counts, never added).${f.closed ? " The pilot has wrapped up; the Report holds the final record." : ""}`;
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
    else if (role === "partner") out = answerPartner(facts, question, t);
    else if (role === "pilot_partner") out = answerPilot(facts, question, t);
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
    // Build -108: Instagram verification prompts, from the
    // record only. The connect prompt fires only while the lane
    // is actually open (gate G4 stands otherwise) and the
    // creator has a stated share to check; the mismatch prompt
    // is private and factual, naming the market and both
    // numbers' direction, never a verdict.
    const avHome = f.audienceVerification || {};
    if (avHome.igConfigured && !avHome.igConnected && f.localPct != null) chips.push("Connect Instagram to verify your local audience");
    if (avHome.belowSelf && avHome.belowSelf.length) chips.push(`Instagram shows a lower local share in ${avHome.belowSelf[0].market} than your profile says`);
    if (avHome.status === "verified" && avHome.verifiedMarkets && avHome.verifiedMarkets.length) chips.push(`Local audience verified in ${avHome.verifiedMarkets[0]}`);
  } else if (role === "partner") {
    // Build -106 partner chips: live state only. A frozen pack
    // waiting is the standing prompt; funnel counts ride along
    // when they exist; a multi-scope login says so once.
    if (f.frozenMonths && f.frozenMonths.length) chips.push(`${f.frozenMonths[0].label} pack is final: download it`);
    if (f.totals && f.totals.creatorsAttributed) chips.push(`${fmt(f.totals.creatorsAttributed)} ${plural(f.totals.creatorsAttributed, "creator")} through your links`);
    if (f.totals && f.totals.businessesAttributed) chips.push(`${fmt(f.totals.businessesAttributed)} ${plural(f.totals.businessesAttributed, "business", "businesses")} through your links`);
    if (f.earnings && f.earnings.owedTotal > 0) chips.push(`${f.earnings.currency === "GBP" ? "£" : "$"}${(Math.round(f.earnings.owedTotal * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} accrued and owed to you`);
    if (f.scopes && f.scopes.length > 1) chips.push(`${fmt(f.scopes.length)} scopes on this login`);
    if (f.race && f.race.state === "running") chips.push("The London race is running");
    if (f.race && f.race.state === "won") chips.push("A district has won the London race");
    // Team seats (Build -107): an invite sitting unaccepted
    // for over a week is the one team nudge.
    if (f.team && f.team.isAdmin) {
      const stale = (f.team.seats || []).find((s) => s.status === "invited" && s.invitedAt && Date.now() - Date.parse(s.invitedAt) > 7 * 86400000);
      if (stale) chips.push(`${(stale.name || "A seat").split(" ")[0]} hasn't accepted their invite yet`);
    }
  } else if (role === "pilot_partner") {
    // Build -106 funder chips: the pack prompt fires only when
    // the pilot has actually ended; otherwise fund state.
    if (f.closed) chips.push("Your end-of-pilot pack is ready");
    if (f.counts && f.counts.visitsDone) chips.push(`${fmt(f.counts.visitsDone)} ${plural(f.counts.visitsDone, "visit")} done`);
    if (f.counts && f.counts.postsLive) chips.push(`${fmt(f.counts.postsLive)} ${plural(f.counts.postsLive, "post")} live`);
    if (f.counts && f.counts.continued) chips.push(`${fmt(f.counts.continued)} ${plural(f.counts.continued, "business", "businesses")} joined SIGNL afterwards`);
    if (f.team && f.team.isAdmin) {
      const stale = (f.team.seats || []).find((s) => s.status === "invited" && s.invitedAt && Date.now() - Date.parse(s.invitedAt) > 7 * 86400000);
      if (stale) chips.push(`${(stale.name || "A seat").split(" ")[0]} hasn't accepted their invite yet`);
    }
  }
  return { chips };
}

function answerFacts(role, facts, question, history) {
  const out = answerFactsRaw(role, facts, question, history);
  if (!out) return null;
  return typeof out === "string" ? out : out.text;
}

module.exports = { buildAdminFacts, buildBusinessFacts, buildCreatorFacts, buildPartnerFacts, buildPilotFacts, factsLines, answerFacts, answerFactsRaw, buildHomeState };
