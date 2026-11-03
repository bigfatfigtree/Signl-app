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
    },
    waiting: { total: pendingAll.length, creators: cs.pending, businesses: bs.pending, list: waiting },
    offers: { ...offerCounts, openByMarket },
    visits: { bookings: bookings.length, completed, upcoming, awaitingPost, overduePosts, postsLive: posts.length },
    partners: { total: partners.length, active: partners.filter((p) => p.status === "active").length, paused: partners.filter((p) => p.status === "paused").length, list: partners },
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
    paidRate: c.paidRate || null,
    licenseFee: c.licensingFee || c.licenseFee || null,
    currencySymbol: currencyForMarket(u.market).symbol,
    currencyCode: currencyForMarket(u.market).code,
    paidFloor: currencyForMarket(u.market).paidFloor,
  };
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
    lines.push(`Partners: ${fmt(f.partners.total)} (${fmt(f.partners.active)} active, ${fmt(f.partners.paused)} paused)${f.partners.list.length ? ": " + f.partners.list.map((p) => `${p.name} (${p.status}${p.markets.length ? ", " + p.markets.join(" + ") : ""})`).join("; ") : ""}. Markets live: ${f.markets.liveCount ? f.markets.liveNames.join(", ") : "none yet"}. Applications waiting on a decision: ${fmt(f.waiting.total)} (${fmt(f.waiting.creators)} ${plural(f.waiting.creators, "creator")}, ${fmt(f.waiting.businesses)} ${plural(f.waiting.businesses, "business", "businesses")}).`);
    lines.push("This admin surface is read-only for you: answer and explain, and point to the Admin tab where an action lives. Never claim you approved, sent, activated, or changed anything.");
    return lines;
  }
  if (role === "business") {
    const lines = [];
    lines.push(`Their business is ${f.businessName} in ${f.market || "an unfiled market"}. The market is ${f.marketLive ? "OPEN (live)" : "NOT open yet, so the business is on the founding list and nothing is charged"}.`);
    if (f.planName) lines.push(`Their plan is ${f.planName} at ${money(f.planPrice)} a month with ${f.visitsPerMonth} creator visits a month and a ${money(f.foundingCredit)} founding credit off the first month. This month they have used ${fmt(f.visitsUsed)} of ${fmt(f.visitsAllowance)} visits (${fmt(f.visitsRemaining)} left${f.visitsCarried ? `, including ${fmt(f.visitsCarried)} rolled over from last month` : ""}).`);
    lines.push(`Their numbers right now: ${fmt(f.offersLive)} offers live, ${fmt(f.draftOffers)} drafts, ${fmt(f.applicantsWaiting)} applicants waiting on their answer, ${fmt(f.visitsBooked)} visits booked, ${fmt(f.postsLive)} posts live. Counted register dollars so far: ${money(f.countedDollars)} (counted means rung up through visit codes). Modeled estimate on top of that: ${money(f.modeledDollars)}, and that figure is an estimate, never a counted sale. Creators with finished profiles in their market: ${fmt(f.rosterInMarket)}.`);
    if (f.intentTotal > 0) lines.push(`Post intent on their live posts: ${fmt(f.intentShares)} shares and ${fmt(f.intentSaves)} saves recorded by the creators, ${fmt(f.intentTotal)} in total across ${fmt(f.intentReportedPosts)} reported ${plural(f.intentReportedPosts, "post")}. Saves and shares mean people planning to come. These are recorded figures, not counted sales. Their Return score across those posts is ${f.returnScore != null ? fmt(f.returnScore) + " out of 100" : "not scored yet (not enough data)"}.`);
    return lines;
  }
  // creator
  const lines = [];
  const lv = f.level;
  lines.push(`Their market is ${f.market || "unknown"} and it is ${f.marketLive ? "OPEN (live)" : "NOT open yet (founding)"}. Their application status is ${f.status || "unknown"}. Their profile is ${f.profileComplete ? "finished, so businesses can see them" : "NOT finished yet; still missing: " + (f.missingLabels.join(", ") || "nothing recorded") + ". A finished profile is the gate for being seen by businesses."}`);
  lines.push(`Their Momentum is ${fmt(f.momentumPoints)} points, level ${lv ? lv.name : "Starter"}${lv && lv.nextName ? `, with ${fmt(lv.nextAt - f.momentumPoints)} points to ${lv.nextName}` : ", the top level"}. Their tier is ${f.tier || "not set yet"}${f.audienceTotal != null ? ` on ${fmt(f.audienceTotal)} total followers across platforms` : ""}. Local audience in their home market: ${f.localPct != null ? f.localPct + "%" : "not reported"}. Markets they are listed in: ${f.listedMarkets.length ? f.listedMarkets.map((m) => `${m.market}${m.pct != null ? " (" + m.pct + "% local)" : ""}`).join(", ") : "just their home market"}.`);
  lines.push(`Their numbers right now: ${fmt(f.offersOpen)} open offers in their markets (${fmt(f.directInvites)} direct invites), ${fmt(f.applicationsPending)} applications waiting on a business's answer, ${fmt(f.visitsBooked)} visits booked, ${fmt(f.postsOwed.length)} posts owed, ${fmt(f.postsLive)} posts live${f.onTimePct != null ? `, ${f.onTimePct}% of their posts on time` : ""}. Paid bookings: ${fmt(f.paidBookings)}, with ${cmoney(f, f.paidRecordedNet)} recorded as their net (recorded means the bookings on file, paid outside the app). License requests waiting on them: ${fmt(f.licenseRequestsPending)}. Creators joined through their invite link: ${fmt(f.referrals.signups)}, of whom ${fmt(f.referrals.approved)} were approved.`);
  if (f.intentTotal > 0) lines.push(`Intent on their own posts: ${fmt(f.intentShares)} shares and ${fmt(f.intentSaves)} saves recorded, ${fmt(f.intentTotal)} in total across ${fmt(f.intentReportedPosts)} reported ${plural(f.intentReportedPosts, "post")}. Saves and shares mean people planning to come.`);
  if (f.paidRate) lines.push(`Their listed paid rate is ${cmoney(f, f.paidRate)}${f.licenseFee ? ` and their licensing fee is ${cmoney(f, f.licenseFee)}` : ""}.`);
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
  // My offers
  if ((hasWord(t, "offer", "offers", "campaign", "campaigns")) && hasPhrase(t, "my", "how many", "do i have", "live", "draft")) {
    const offersText = `You have ${fmt(f.offersLive)} offers live and ${fmt(f.draftOffers)} in draft, out of ${fmt(f.visitsBooked)} visits booked from them so far.${f.founding ? " Your market is not open yet, so drafts save for opening day and nothing sends until it activates." : ""}`;
    return (f.offersLive || f.draftOffers) ? linked(offersText, "Open My Offers", "biz-offers") : offersText;
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
  // Licenses
  if (hasWord(t, "license", "licenses", "licensing") && hasPhrase(t, "my", "how many", "waiting", "pending")) {
    const licText = `Your licenses: ${fmt(f.licensesGranted)} granted and in your library, ${fmt(f.licensesPending)} requested and waiting on the creator's answer. Each granted license is 90 days of repost and ad use, and its end date sits on the post in Posts & licenses.`;
    return (f.licensesGranted || f.licensesPending) ? linked(licText, "Open Posts and licenses", "biz-content") : licText;
  }
  return null;
}

// ---------- CREATOR ----------
function answerCreator(f, q, t) {
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
  } else if (role === "creator") {
    if (f.directInvites) chips.push(`${fmt(f.directInvites)} ${plural(f.directInvites, "invite")} sent to you`);
    if (f.offersOpen) chips.push(`${fmt(f.offersOpen)} ${plural(f.offersOpen, "offer")} waiting`);
    if (f.postsOwed && f.postsOwed.length) chips.push(`${fmt(f.postsOwed.length)} ${plural(f.postsOwed.length, "post")} owed`);
    if (f.applicationsPending) chips.push(`${fmt(f.applicationsPending)} ${plural(f.applicationsPending, "application")} waiting on an answer`);
    if (f.licenseRequestsPending) chips.push(`${fmt(f.licenseRequestsPending)} license ${plural(f.licenseRequestsPending, "request")} waiting`);
    chips.push(`${fmt(f.momentumPoints)} Momentum points`);
    chips.push(f.profileComplete ? "Profile live" : (f.missingLabels && f.missingLabels.length ? `Profile: ${fmt(f.missingLabels.length)} ${plural(f.missingLabels.length, "step")} to finish` : "Profile not finished"));
    if (f.founding) chips.push(`Founding roster${f.market ? " · " + f.market : ""}`);
    else if (f.marketLive) chips.push(`${f.market || "Your market"} is live`);
  }
  return { chips };
}

function answerFacts(role, facts, question, history) {
  const out = answerFactsRaw(role, facts, question, history);
  if (!out) return null;
  return typeof out === "string" ? out : out.text;
}

module.exports = { buildAdminFacts, buildBusinessFacts, buildCreatorFacts, factsLines, answerFacts, answerFactsRaw, buildHomeState };
