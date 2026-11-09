// Biz Dev Dashboard (Build -155) — the field-seller system.
//
// Spec: bizdev-dashboard-spec-2026-11-08.md + JEFF'S RULINGS
// (2026-11-08 23:23 ET) appended to it, which supersede its §12:
//   (3) NO founding-spot numbers anywhere — a business never sees
//       a position number, and neither does the rep. Claim DATE is
//       kept internally (activation queue order, ruling 2) only.
//   (4) NO escalation response-time promise — the Seller Kit
//       carries Jeff's holding line only.
//
// Shape: a module in the recruiters.js style. router.js wires it
// under seg "bdev" (rep API + the public founding-claim page) and
// seg "admin"/"bdev" (HQ). A rep is a SEAT on an existing account
// (user.bizdevSeat summary on the user record; the full record at
// bdevrep:{userId}). The account's own role never changes — Tony
// Johnson stays a tester creator; the seat makes Rep Home his
// default shell and his tester profile stays invisible forever.
//
// Scoping is enforced HERE, in the data layer: every rep read and
// write derives market + rep from the signed-in user's seat, never
// from client input. A lead outside the seat's market/book simply
// does not exist for that login.
//
// Canon held throughout: payments OFF (no checkout, no "paid"
// stage — the top of the pipeline is "Founding spot claimed");
// founding confirmations are HQ's lane; vesting/tiers count
// Jeff-confirmed ACTIVATIONS only; comfort-call / do-not-contact
// flags hard-disable contact actions and their reasons never
// leave the server.

const crypto = require("crypto");
const storeLib = require("./store");
const { logEvent: logEventRaw } = require("./events");

let deps = {};
function init(d) { deps = Object.assign({}, deps, d || {}); }
const store = () => storeLib;
function nowIso() { return new Date().toISOString(); }
const uuid = () => crypto.randomUUID();
function logEvent(e) { try { return logEventRaw(e); } catch (err) { return null; } }
function logCapture(e) { try { if (deps.logCapture) return deps.logCapture(e); } catch (err) { /* best-effort */ } return null; }

// Build -157 Phase B: the Phase A enrichment pack (playbooks,
// pre-warm drafts, practice set) ships beside this module. Loaded
// once at module load; a missing file degrades to no enrichment
// and no practice set, never a crash.
let ENRICH157 = null;
try { ENRICH157 = require("./bizdev-enrich-hr-157.json"); } catch (e) { ENRICH157 = null; }

// HQ load 2026-11-09: Jeff-ordered destination (drive-market)
// leads for Tony's book, in the same beside-the-module pattern.
let DEST2026 = null;
try { DEST2026 = require("./bizdev-load-dest-2026-11-09.json"); } catch (e) { DEST2026 = null; }

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
function err(statusCode, message) { return json(statusCode, { error: message }); }
function htmlPage(body) {
  return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body };
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function parseBody(event) {
  try { return JSON.parse(event.body || "{}"); } catch (e) { return {}; }
}

// ---------------- constants ----------------

const CATEGORIES = ["Restaurants & Dining", "Bars & Nightlife", "Health & Aesthetics", "Beauty & Grooming", "Experiences & Attractions", "Retail & Boutiques"];
const STAGES = ["Not visited yet", "Visited — owner not in", "Talked — needs to think", "Talked — wants a follow-up", "Founding spot claimed", "Said no", "Not a fit"];
const STAGE_CLAIMED = "Founding spot claimed";
const OUTCOMES = ["Claimed a founding spot", "Very interested — set a follow-up", "Talked — needs to think", "Talked to staff — need the owner", "Owner not in", "Said no", "Shop closed / not a fit", "Owner said never contact again"];
const OBJECTIONS = ["Price", "No time", "Tried influencers before", "Doesn't get local %", "Asked when it launches", "Wants to pick creators", "Worried about no-shows", "Wants to know who else is on it", "Other"];
const WANT_CATS = ["Food", "Fitness", "Beauty", "Lifestyle", "Going Out", "Other"];
const COMPETITORS = ["Instagram direct", "An agency", "Another platform", "Radio", "None"];
const NOT_FIT_REASONS = ["Closed permanently", "Wrong category", "Chain — HQ decision", "Duplicate", "Other"];
// Build -157: the official STATUS control — one short list every
// surface (rep book, HQ rollup, filters) reads. A lead with no
// stored status derives one from its stage, so the -155 book
// reads correctly before anyone sets a status by hand.
const STATUSES = ["Not contacted", "Contacted", "Meeting set", "Follow up", "Declined", "Closed"];
function statusOf(lead) {
  if (lead && STATUSES.includes(lead.status)) return lead.status;
  const stage = (lead && lead.stage) || "";
  if (stage === "Not visited yet") return "Not contacted";
  if (stage === STAGE_CLAIMED) return "Closed";
  if (stage === "Said no" || stage === "Not a fit") return "Declined";
  return "Contacted";
}
async function setLeadStatus(lead, status, by) {
  lead.status = status;
  lead.statusHistory = [...(lead.statusHistory || []), { status, at: nowIso(), by }];
  await saveLead(lead);
  return lead;
}

const GATE = { low: 50, high: 60 };
const GATE_BUCKETS = ["Food", "Fitness", "Beauty", "Lifestyle", "Going Out"];
const BLENDED_MONTHLY = 326.50;
const PLANS = [199, 349, 699];

// Hampton Roads drive-order for route clusters (west/south first
// is wrong for HR: clusters sort so a day never crisscrosses the
// bridge-tunnels more than once — Peninsula, then the harbor
// crossing, then Southside west to east). Unknown neighborhoods
// sort after, alphabetically.
const HR_ZONE_ORDER = ["Phoebus Hampton", "Downtown Hampton", "Downtown Newport News", "City Center Newport News", "Olde Towne Portsmouth", "Downtown Norfolk", "Ghent Norfolk", "Park Place", "Riverview", "Waterside, Norfolk", "Great Bridge Chesapeake", "Greenbrier", "Medical Parkway, Chesapeake", "Kempsville", "Liberty Way, Virginia Beach", "Republic Road, Virginia Beach", "Atlantic Park, Virginia Beach", "Virginia Beach Oceanfront", "ViBe District", "Rudee Inlet, Virginia Beach", "Hilltop", "Lynnhaven", "Red Mill", "North Landing Road area, Virginia Beach", "Shore Drive, Virginia Beach", "General Booth Blvd, Virginia Beach", "Pleasure House Road area, Virginia Beach"];

// ---------------- normalization / dup keys ----------------

function normName(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " "); }
function digits(s) { return String(s || "").replace(/\D+/g, "").replace(/^1(?=\d{10}$)/, ""); }
function normIg(s) { return String(s || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9._]/g, ""); }
function normEmail(s) { return String(s || "").toLowerCase().trim(); }

function leadMatchKeys(lead) {
  const keys = [];
  for (const p of [lead.phone1, lead.phone2]) { const d = digits(p); if (d.length >= 7) keys.push("ph:" + d); }
  if (lead.instagram) keys.push("ig:" + normIg(lead.instagram));
  if (lead.email) keys.push("em:" + normEmail(lead.email));
  if (lead.name) keys.push("nm:" + normName(lead.name));
  return keys;
}

// ---------------- seats ----------------

async function seatOf(user) {
  if (!user) return null;
  const rec = await store().get(`bdevrep:${user.id}`);
  if (!rec || !rec.active) return null;
  return rec;
}

async function assignSeat({ userId, marketId, marketName, repCode, seatState }) {
  const rec = {
    userId, marketId, marketName, repCode,
    active: true, seatState: seatState || "probation",
    assignedAt: nowIso(), pinHash: null, pinSalt: null,
    vestedAt: null, warningMonth: null, atRisk: null,
  };
  await store().set(`bdevrep:${userId}`, rec);
  return rec;
}

async function stampUserSeat(user, seat) {
  user.bizdevSeat = seat && seat.active
    ? { active: true, marketId: seat.marketId, marketName: seat.marketName, repCode: seat.repCode }
    : { active: false };
  await store().set(`user:${user.id}`, user);
}

// Build -161: multi-market seats (Jeff's HQ seat). A seat's home
// market stays seat.marketId; a seat that works more than one
// market carries seat.markets = [{marketId, marketName}]. Every
// rep read/write still derives its market from the seat — the
// client may only ASK for one of the seat's own markets (?mkt=),
// and the effective seat below is what the existing builders
// consume, so per-city behaviour (day plan, queue, gate
// progress, Show bench) comes from the same code paths.
function seatMarkets(seat) {
  if (seat && Array.isArray(seat.markets) && seat.markets.length) {
    return seat.markets.map((m) => ({ marketId: m.marketId, marketName: m.marketName || m.marketId }));
  }
  return seat ? [{ marketId: seat.marketId, marketName: seat.marketName }] : [];
}
function seatHasMarket(seat, marketId) { return seatMarkets(seat).some((m) => m.marketId === marketId); }
function effectiveSeat(seat, marketId) {
  if (!marketId || marketId === seat.marketId) return seat;
  const m = seatMarkets(seat).find((x) => x.marketId === marketId);
  if (!m) return null;
  return { ...seat, marketId: m.marketId, marketName: m.marketName };
}
function seatSummary(seat) {
  return { marketId: seat.marketId, marketName: seat.marketName, markets: seatMarkets(seat), hqSeat: !!seat.hqSeat, repCode: seat.repCode };
}

function pinHashOf(pin, salt) { return crypto.createHash("sha256").update(`${salt}:${pin}`).digest("hex"); }

// ---------------- leads ----------------

async function allLeads() {
  const rows = await store().list("bdevlead:");
  return rows.map((r) => r.value).filter(Boolean);
}
async function leadsOfMarket(marketId) { return (await allLeads()).filter((l) => l.marketId === marketId); }
async function getLead(id) { return id ? store().get(`bdevlead:${id}`) : null; }
async function saveLead(lead) { lead.updatedAt = nowIso(); await store().set(`bdevlead:${lead.id}`, lead); return lead; }

async function allLogs(leadId) {
  const rows = await store().list("bdevlog:");
  return rows.map((r) => r.value).filter((v) => v && (!leadId || v.leadId === leadId))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function dupCheck(marketLeads, allMarketLeadsGlobal, candidate, excludeId) {
  // Hard: phone or Instagram match anywhere (any market) — the rep
  // learns only THAT it is taken, never by whom or where.
  const candKeys = leadMatchKeys(candidate);
  const hardKeys = candKeys.filter((k) => k.startsWith("ph:") || k.startsWith("ig:"));
  for (const lead of allMarketLeadsGlobal) {
    if (excludeId && lead.id === excludeId) continue;
    const keys = leadMatchKeys(lead);
    if (hardKeys.some((k) => keys.includes(k))) {
      return { hard: lead, inMarket: lead.marketId === candidate.marketId };
    }
  }
  // Soft: normalized name + same neighborhood within the market.
  const nm = "nm:" + normName(candidate.name);
  for (const lead of marketLeads) {
    if (excludeId && lead.id === excludeId) continue;
    if (normName(lead.name) === normName(candidate.name) && normName(lead.neighborhood) === normName(candidate.neighborhood)) {
      return { soft: lead };
    }
    void nm;
  }
  return {};
}

function priorityWords(lead) {
  if (lead.hqTier === "A") return "Visit first";
  if (lead.hqTier === "C") return "Fill-in stop";
  return "Visit soon";
}

function daysLateWords(dateStr) {
  if (!dateStr) return null;
  const due = new Date(dateStr + "T12:00:00");
  const today = new Date(nowIso().slice(0, 10) + "T12:00:00");
  const diff = Math.round((today - due) / 86400000);
  if (diff <= 0) return null;
  return diff === 1 ? "1 day late" : `${diff} days late`;
}

// The rep-safe lead payload: internal fields (HQ notes, flag
// reasons, dispute state, source research) never leave the server.
function repLeadPayload(lead, opts) {
  const full = !!(opts && opts.full);
  const flags = lead.flags || {};
  const out = {
    id: lead.id,
    name: lead.name, shortName: lead.shortName || null,
    category: lead.category, subType: lead.subType || "",
    neighborhood: lead.neighborhood || "", city: lead.city || "",
    address: lead.address || null,
    website: lead.website || null,
    dmName: lead.dmName || null, dmRoleLabel: lead.dmRoleLabel || null,
    secondContact: lead.secondContact || null,
    usuallyHere: lead.usuallyHere || null,
    phone1: lead.phone1 || null, phone2: lead.phone2 || null,
    phoneVerify: !!(lead.phone1Verify || lead.phone2Verify),
    phone1Note: lead.phone1Note || null, phone2Note: lead.phone2Note || null,
    email: lead.email || null,
    instagram: lead.instagram || null,
    priority: priorityWords(lead),
    stage: lead.stage,
    status: statusOf(lead),
    source: lead.source,
    pendingApproval: !!lead.pendingApproval,
    championName: lead.attribution && lead.attribution.championName ? lead.attribution.championName : null,
    flags: {
      doNotContact: !!flags.doNotContact,
      jeffHandles: !!flags.jeffHandles,
      chain: !!flags.chain,
      noEmail: !lead.email,
    },
    founding: {
      status: lead.founding ? lead.founding.status : "Not claimed",
      confirmed: !!(lead.founding && lead.founding.status === "Confirmed"),
      planInterest: lead.founding && lead.founding.planInterest ? lead.founding.planInterest : null,
    },
    nextAction: lead.nextAction || null,
    hasStorefrontPhoto: !!lead.hasStorefrontPhoto,
    nextLate: lead.nextAction && lead.nextAction.date ? daysLateWords(lead.nextAction.date) : null,
    lastTouch: lead.lastTouch || null,
    createdAt: lead.createdAt,
  };
  if (full) {
    out.stageHistory = lead.stageHistory || [];
    out.statusHistory = lead.statusHistory || [];
    out.playbook = lead.playbook || null;
    out.claimLink = lead.attribution && lead.attribution.repCode ? claimPath(lead) : null;
  }
  return out;
}

function claimPath(lead) {
  const code = lead.attribution && lead.attribution.repCode;
  return `/founding-claim?rep=${encodeURIComponent(code || "")}&lead=${encodeURIComponent(lead.id)}`;
}

// ---------------- DNC store (platform-canonical) ----------------

async function dncRecords() {
  const rows = await store().list("bdevdnc:");
  return rows.map((r) => r.value).filter(Boolean);
}
async function addDnc({ key, kind, label, source, at }) {
  const rec = { key, kind, label: label || "", source: source || "", createdAt: at || nowIso() };
  await store().set(`bdevdnc:${key}`, rec);
  return rec;
}
async function dncHitFor(lead, records) {
  const keys = leadMatchKeys(lead);
  const nameKey = "nm:" + normName(lead.name);
  return records.find((r) => keys.includes(r.key) || r.key === nameKey) || null;
}

// ---------------- market state + gate ----------------

async function marketState(marketId) {
  const cfg = (await store().get("config:bdevMarkets")) || {};
  return (cfg[marketId] && cfg[marketId].state) || "Building";
}
async function setMarketState(marketId, state) {
  const cfg = (await store().get("config:bdevMarkets")) || {};
  cfg[marketId] = { state, updatedAt: nowIso() };
  await store().set("config:bdevMarkets", cfg);
  return cfg[marketId];
}

function gateBucketOf(creatorCats) {
  const cats = creatorCats || [];
  const buckets = new Set();
  for (const c of cats) {
    if (c === "Food & Drink") buckets.add("Food");
    else if (c === "Fitness & Wellness" || c === "Sports" || c === "Health & Wellness") buckets.add("Fitness");
    else if (c === "Beauty & Grooming") buckets.add("Beauty");
    else if (c === "Nightlife" || c === "Attractions & Events") buckets.add("Going Out");
    else buckets.add("Lifestyle");
  }
  return buckets;
}

async function marketProgress(marketId) {
  const creators = deps.marketCreators ? await deps.marketCreators(marketId) : { count: 0, byBucket: {}, bench: [] };
  const leads = await leadsOfMarket(marketId);
  const claimed = leads.filter((l) => l.founding && (l.founding.status === "Claimed" || l.founding.status === "Confirmed")).length;
  const byBucket = {};
  for (const b of GATE_BUCKETS) {
    const n = (creators.byBucket && creators.byBucket[b]) || 0;
    byBucket[b] = { count: n, word: n === 0 ? "Need more" : n < 5 ? "Getting there" : "Ready" };
  }
  return {
    creators: creators.count || 0, gateLow: GATE.low, gateHigh: GATE.high,
    byBucket, foundingClaimed: claimed,
    state: await marketState(marketId),
  };
}

// ---------------- route / day plan ----------------

function zoneRank(neighborhood) {
  const i = HR_ZONE_ORDER.indexOf(neighborhood || "");
  return i === -1 ? 1000 : i;
}
function clusterLeads(leads) {
  const byZone = new Map();
  for (const l of leads) {
    const z = l.neighborhood || "Other area";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push(l);
  }
  return [...byZone.entries()]
    .sort((a, b) => zoneRank(a[0]) - zoneRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([zone, items]) => ({ zone, items }));
}

function todayStr() { return nowIso().slice(0, 10); }

async function dayPlan(seat) {
  const leads = (await leadsOfMarket(seat.marketId)).filter((l) => l.assignedRepId === seat.userId);
  const today = todayStr();
  const due = leads.filter((l) => l.nextAction && l.nextAction.date && l.nextAction.date <= today && l.stage !== STAGE_CLAIMED && l.stage !== "Said no" && l.stage !== "Not a fit")
    .sort((a, b) => String(a.nextAction.date).localeCompare(String(b.nextAction.date)));
  // The day's working cluster: the zone holding the most
  // not-yet-visited leads; due follow-ups in that zone join it.
  const unvisited = leads.filter((l) => l.stage === "Not visited yet" && !(l.flags && (l.flags.doNotContact || l.flags.jeffHandles)));
  const clusters = clusterLeads(unvisited);
  const main = clusters.length ? clusters.slice().sort((a, b) => b.items.length - a.items.length)[0] : null;
  const stops = [];
  const seen = new Set();
  for (const l of due) { if (!seen.has(l.id)) { stops.push(l); seen.add(l.id); } }
  if (main) for (const l of main.items) { if (!seen.has(l.id)) { stops.push(l); seen.add(l.id); } }
  // Order the stops by zone so the drive never crisscrosses.
  stops.sort((a, b) => zoneRank(a.neighborhood) - zoneRank(b.neighborhood));
  const logs = (await store().list("bdevlog:")).map((r) => r.value).filter((v) => v && v.repId === seat.userId && v.visitAt && v.visitAt.slice(0, 10) === today);
  const doneIds = new Set(logs.map((v) => v.leadId));
  return {
    date: today,
    zoneLabel: main ? main.zone : (due.length ? (due[0].neighborhood || "Follow-ups") : null),
    stops: stops.map((l) => repLeadPayload(l)),
    doneCount: stops.filter((l) => doneIds.has(l.id)).length,
    totalCount: stops.length,
    clusters: clusters.map((c) => ({ zone: c.zone, count: c.items.length })),
  };
}

// ---------------- visit logging → stage machine ----------------

const OUTCOME_STAGE = {
  "Claimed a founding spot": STAGE_CLAIMED,
  "Very interested — set a follow-up": "Talked — wants a follow-up",
  "Talked — needs to think": "Talked — needs to think",
  "Talked to staff — need the owner": "Talked — needs to think",
  "Owner not in": "Visited — owner not in",
  "Said no": "Said no",
  "Shop closed / not a fit": "Not a fit",
  "Owner said never contact again": "Said no",
};
const OUTCOME_DEFAULT_FOLLOWUP = {
  "Claimed a founding spot": null,
  "Very interested — set a follow-up": 1,
  "Talked — needs to think": 3,
  "Talked to staff — need the owner": 3,
  "Owner not in": 3,
  "Said no": null,
  "Shop closed / not a fit": null,
  "Owner said never contact again": null,
};

function addDaysStr(base, n) {
  const d = new Date(base + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------- comp engine ----------------
// Records: bdevact:{businessKey} — one per activated business:
// { id, repId, marketId, leadId, businessName, direct: bool,
//   plan: 199|349|699|null, activatedAt, windowStart (yyyy-mm),
//   months: [{ month: "yyyy-mm", collected: number, refunded: bool }],
//   championName: string|null }
// Money accrues ONLY from collected amounts on Jeff-confirmed
// activations, inside each business's 12-month window.

function monthOf(iso) { return String(iso || "").slice(0, 7); }
function monthAdd(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

async function activationsOf(repId, marketId) {
  const rows = await store().list("bdevact:");
  return rows.map((r) => r.value).filter((v) => v && v.repId === repId && (!marketId || v.marketId === marketId));
}
async function allActivations() {
  const rows = await store().list("bdevact:");
  return rows.map((r) => r.value).filter(Boolean);
}

// Kept book at a month: businesses whose window covers that month
// and which have not churned (a months entry with churned:true
// ends the book membership the month it lands).
function keptBookAt(acts, ym) {
  return acts.filter((a) => {
    if (!a.windowStart) return false;
    if (ym < a.windowStart || ym > monthAdd(a.windowStart, 11)) return false;
    const churn = (a.months || []).find((m) => m.churned && m.month <= ym);
    return !churn;
  });
}
function newActivationsIn(acts, ym) { return acts.filter((a) => monthOf(a.activatedAt) === ym); }

function rateForMonth(directActs, ym) {
  const kept = keptBookAt(directActs, ym).length;
  const prevKept = keptBookAt(directActs, monthAdd(ym, -1)).length;
  const shrank = kept < prevKept;
  let rate = 0.25;
  if (!shrank && kept >= 75) rate = 0.35;
  else if (!shrank && kept >= 25) rate = 0.30;
  const kicked = newActivationsIn(directActs, ym).length >= 5;
  if (kicked) rate += 0.03;
  if (rate > 0.38) rate = 0.38;
  return { rate, kept, shrank, kicked };
}

function vestingOf(directActs) {
  const total = directActs.length;
  // 3 straight months of 3+ activations
  const byMonth = {};
  for (const a of directActs) { const m = monthOf(a.activatedAt); byMonth[m] = (byMonth[m] || 0) + 1; }
  const months = Object.keys(byMonth).sort();
  let streak = 0, best = 0, streakMonths = [];
  let prev = null;
  for (const m of months) {
    const consecutive = prev && monthAdd(prev, 1) === m;
    if (byMonth[m] >= 3) { streak = consecutive ? streak + 1 : 1; streakMonths = consecutive ? [...streakMonths, m] : [m]; }
    else { streak = 0; streakMonths = []; }
    if (streak > best) best = streak;
    prev = m;
  }
  const currentStreak = streak;
  return {
    byCount: { have: total, need: 15, done: total >= 15 },
    byStreak: { months: streakMonths, have: currentStreak, need: 3, done: best >= 3 },
    vested: total >= 15 || best >= 3,
  };
}

async function moneyFor(repId, marketId) {
  const acts = await activationsOf(repId, marketId);
  const direct = acts.filter((a) => a.direct);
  const residual = acts.filter((a) => !a.direct);
  const vesting = vestingOf(direct);
  let accrued = 0;
  const perBusiness = [];
  const monthsSeen = new Set();
  for (const a of acts) for (const m of a.months || []) monthsSeen.add(m.month);
  const rateByMonth = {};
  for (const ym of monthsSeen) rateByMonth[ym] = rateForMonth(direct, ym);
  for (const a of acts) {
    let bizAccrued = 0;
    for (const m of a.months || []) {
      if (!m.collected) continue;
      if (m.month < a.windowStart || m.month > monthAdd(a.windowStart, 11)) continue;
      if (a.direct) bizAccrued += m.collected * (rateByMonth[m.month] ? rateByMonth[m.month].rate : 0.25);
      else if (vesting.vested) bizAccrued += m.collected * 0.05;
    }
    accrued += bizAccrued;
    perBusiness.push({
      id: a.id, businessName: a.businessName, leadId: a.leadId || null,
      lane: a.direct ? "Direct" : "Residual",
      plan: a.plan || null, activatedAt: a.activatedAt,
      windowStart: a.windowStart, windowMonth: a.windowStart ? (monthsSeen.size ? undefined : undefined) : null,
      accrued: Math.round(bizAccrued * 100) / 100,
      championName: a.championName || null,
    });
  }
  const ym = monthOf(nowIso());
  const rateNow = rateForMonth(direct, ym);
  return {
    accrued: Math.round(accrued * 100) / 100,
    activations: direct.length,
    rateNow, vesting,
    perBusiness: perBusiness.sort((a, b) => String(a.activatedAt).localeCompare(String(b.activatedAt))),
    residualCount: residual.length,
  };
}

async function liability() {
  const acts = await allActivations();
  const reps = [...new Set(acts.map((a) => a.repId))];
  let total = 0; const perRep = []; let counted = 0;
  for (const repId of reps) {
    // Build -161: an HQ seat (Jeff's own) never accrues commission
    // liability — he isn't paying himself. Its activations still
    // happened; they just owe nobody anything.
    const seatRec = await store().get(`bdevrep:${repId}`);
    if (seatRec && seatRec.hqSeat) continue;
    const marketId = (acts.find((a) => a.repId === repId) || {}).marketId;
    const m = await moneyFor(repId, marketId);
    total += m.accrued;
    counted += acts.filter((a) => a.repId === repId).length;
    perRep.push({ repId, marketId, accrued: m.accrued, activations: m.activations, vested: m.vesting.vested });
  }
  return { totalAccrued: Math.round(total * 100) / 100, perRep, activations: counted };
}

// ---------------- Seller Kit (verbatim, spec §6) ----------------

const KIT = {
  version: "2026-11-09",
  deck: { label: "Seller deck", version: "v4 — Nov 8", url: "/assets/bizdev-deck-v4.pdf" },
  openers: [
    { title: "30-second opener", text: "Hey, I'm Tony — I'm local, I'm with Magpie. Magpie is local influencer marketing: real creators right here in Hampton Roads, whose followers actually live here. We're putting together the founding creator list now, and when we open, local shops will use those creators to get neighbors in the door. Shops like yours are claiming founding spots before we open. Can I show you the creators for two minutes? That's it." },
    { title: "How the founding list works", text: "We don't open a city until the creator side is full — about fifty to sixty local creators, across food, beauty, fitness, going out, all of it, so any shop here has somebody worth picking. While that list fills, shops claim founding spots. First pick of creators, founding pricing locked. We open when the roster's full — I won't give you a date I can't keep, but founding shops hear first." },
  ],
  priceAnswers: [
    { title: "Price (only when they ask)", text: "Founding plans are 199, 349, or 699 a month, with a 3-month minimum, and there's a $100 credit on the first month. Which one fits depends on how much you'd use it — you'd pick when we open. Nothing to pay today." },
    { title: "“When do I pay?”", text: "Not today, and not until we open here. Claiming a spot today is just your name on the founding list. When we're close to opening, our team reaches out, you pick your plan then, and the $100 first-month credit is on it." },
  ],
  objections: [
    { key: "Price", q: "“Too expensive.”", a: "Fair — and you don't have to decide that today. The founding spot costs nothing to hold; the plan choice only matters when we open. What I can promise is you pick every creator and you see a count at the register for every visit — you're never paying for a guess." },
    { key: "No time", q: "“No time for this.”", a: "Totally get it — that's why it's thirty seconds. I'll put your name on the founding list, leave my card, and when we open, setup happens with you, not by you. If it's never a fit, you've lost nothing but this conversation." },
    { key: "Tried influencers before", q: "“Tried influencers before — didn't work.”", a: "Most shops have. Usually it's someone with a big following somewhere else. Ours are ranked by how many followers live here — I'll show you: this creator, 8 out of 10 of her people are Hampton Roads. And every visit carries a code, so this time you'd see the count yourself instead of taking anyone's word." },
    { key: "Doesn't get local %", q: "“What's a local %?”", a: "Simple version: if a creator has a hundred followers and eighty-two of them live here in Hampton Roads, that's her local number. We show it as “8 out of 10 followers live here.” A famous person might be 1 out of 10 here. For your shop, the 8-out-of-10 person is worth more." },
    { key: "Asked when it launches", q: "“When does it launch?”", a: "When the founding creator roster is full — that's the honest answer, and it's why shops are invited in early. I won't invent a date. Founding shops are first to know and first to pick." },
    { key: "Wants to pick creators", q: "“Can I pick my own creators?”", a: "Yes — always. You see the list, you see who their local followers are, you choose, and you approve every visit before anything happens. Nobody gets sent to you." },
    { key: "Worried about no-shows", q: "“What if a creator doesn't show up / doesn't post?”", a: "Then it's counted as a miss — the system tracks it, not you. Misses have real consequences on Magpie: late and missed posts cost a creator their standing, repeat no-shows pause their offers and then remove them, and a shop that got stood up gets a replacement. You'd never be chasing a creator yourself; that's our job." },
    { key: "Wants to know who else is on it", q: "“Who else is on it?”", a: "I keep every shop's business private — same as I'd keep yours — so I can't give you names. What I can show you is the creator side, which is public, and tell you founding spots are being claimed across restaurants, beauty, and going-out spots here in Hampton Roads." },
  ],
  closing: [
    { title: "Leave-it-with-me close", text: "No pressure either way. Two options: I can put your name down for a founding spot right now — takes thirty seconds, nothing to pay — or I'll leave you this card. It's got a code on it; if you claim through it later, it comes back to me and I'll look after you personally." },
  ],
  // Build -157 (Jeff, 2026-11-09): the Business Explainer Kit
  // lives in the Seller Kit. One canonical set of words: the
  // talk tracks and FAQ below are the explainer's own text
  // (magpie-business-explainer-2026-11-09.md, sections B + D);
  // the objection answers above stay the single objection set —
  // the explainer carries those word for word, never a copy here.
  printKit: [
    { label: "Your leave-behind cards — print these", note: "The card you hand over at the door. Print a stack and keep them in the car.", url: "/assets/magpie-leavebehind-tony-v6-2026-11-09-print.pdf" },
    { label: "The business one-pager — leave this behind", note: "The whole story on one page, front and back. Leave it when they want to think it over.", url: "/assets/magpie-business-onepager-tony-v2-2026-11-09-print.pdf" },
  ],
  twoMinute: {
    title: "The 2-minute version",
    paras: [
      "Quick version of what this is. Most advertising a local shop buys can't be counted — you spend the money and hope. And most 'influencers' are no help either: a big following usually means people three states away who will never walk into your shop.",
      "Magpie is local influencer marketing. It's a list of real creators right here in Hampton Roads, and every one of them is ranked by how many of their followers actually live here — neighbors, not follower counts. When a creator has a hundred followers and eighty-two of them live here, that's who you want: eight out of ten of her people are your neighbors.",
      "Here's how a visit works. You pick a creator — you approve every single one, nothing ever posts without you. You can treat them to a visit — a meal, a service, an experience — and they post about it. Or you can book them at their own listed rate for bigger work. Either way, every visit carries that creator's own code, redeemed at your register. So afterwards you don't get a guess or a good feeling — you get a count: exactly how many people came in because of that creator.",
      "Hampton Roads hasn't opened yet. We're filling the founding creator list first — about fifty to sixty local creators across food, fitness, beauty, going out, all of it — and shops that claim a founding spot now get first pick of those creators when we open, with founding pricing locked. Claiming takes about a minute and there's nothing to pay today. Want me to put your name down, or leave you the card so you can look it over?",
    ],
  },
  faq: [
    { q: "What does it cost?", a: "There's nothing to pay today, and founding pricing is locked for founding shops. The plan choice — and the first payment — only happen when we open here. If you'd like the actual numbers now, just ask Tony and he'll show you the founding plans privately, in person. They are never printed and never quoted unasked." },
    { q: "What exactly do I get when it opens?", a: "A page for your business on Magpie, your matched creators with their local numbers shown up front, the ability to invite creators for visits or book them at their listed rates, and a counted record of every customer who comes in on a creator's code." },
    { q: "Do I have to be on Instagram or post anything myself?", a: "No. The creators post to their followers. Your job in a visit is the part you already do — run your shop. Your Magpie page is built with our team." },
    { q: "How much of my time does this take?", a: "About a minute to claim your spot. When we open: you look at your matched creators, say yes or no, and approve a visit when one's proposed. Maggie handles lining people up; Magpie handles the codes and the counting." },
    { q: "How will I know it worked?", a: "You'll see the count — customers who redeemed a creator's code at your register, per creator. No impressions report, no guesswork. If a creator's people came in, it's a number on your screen." },
    { q: "What if nobody comes in from a visit?", a: "Then the count says so, plainly, and you'll know that creator isn't right for your shop — and the system learns it too. With a treated visit, what you put in was the experience itself, which you chose and approved ahead of time. We never promise a count in advance; we show you the real one after." },
    { q: "Can a creator post something I don't like?", a: "Nothing posts without a visit you approved, and every creator works to Magpie's visit terms — a treated visit is 1 post + 1 story about the experience. A creator who misses or mishandles a visit is counted down by the system, not argued with by you." },
    { q: "Why do creators do this?", a: "Because it's their neighborhood too. Local creators build their name by being the person who knows the spots here — and treated visits and paid bookings at their own rate are how Magpie lets a shop thank them properly." },
    { q: "Why “founding”? Why not just wait until you open?", a: "Because when we open, the founding creator list gets picked over — and founding shops pick first, at founding pricing, with their pages already built. Waiting costs you your place in that line and nothing else changes." },
    { q: "Who's behind Magpie?", a: "Magpie is built by Jeff Rimmer, a founder who's spent two decades in local media and startups. Tony is local — he's the neighbor who'll hand you this card, and the person who looks after Hampton Roads founding shops day to day." },
  ],
  foundingTerms: [
    "Founding plans: $199 / $349 / $699 a month",
    "3-month minimum",
    "$100 off the first month",
    "Creators keep 97% of their own listed rate — the 3% is card processing",
    "A comped visit is 1 post + 1 story",
    "The gate, in words: about fifty to sixty local creators, balanced across categories",
    "Nothing to pay today — paying starts when we open here",
  ],
  doNotSay: [
    "Never quote a price unless they ask first",
    "Never promise results, foot traffic, sales, or return on spend",
    "Never say “no commitment”",
    "Never give a launch date, a month, or “probably by…”",
    "Never offer a discount, a free month, a special split, or partner terms",
    "Never name another business, or say whether it has claimed",
    "Never mention commissions, tiers, vesting, or how you're paid",
    "Never promise a payout date or a charge date",
    "Never talk down a creator or another platform by name",
    "Never invent a creator, a follower count, or a local number that isn't on the card in front of you",
    "Never tell a business what your research says about them — it guides the visit, it is never spoken",
  ],
  holdingLine: "That's above what I can say yes to — and I won't guess at it. That's Jeff's call, he's the founder. I'll put it to him today and come back to you with his actual answer, not my version of it.",
  escalationReasons: ["Wants a discount or free months", "Partner, sponsorship, or media talk", "Chain or multi-location deal", "Wants to invest", "Complaint about Magpie", "Press", "Other"],
};

// Build -157 practice set: Phase A's doorstep scenarios, each
// answered with the LIVE kit's own words (never a second copy of
// the approved text — if the kit changes, practice changes).
function practiceAnswer157(kit, n) {
  const k = kit || KIT;
  const obj = (key) => { const o = k.objections.find((x) => x.key === key); return o ? o.a : null; };
  switch (Number(n)) {
    case 1: return k.priceAnswers[0].text;
    case 2: return obj("Asked when it launches");
    case 3: return obj("Tried influencers before");
    case 4: return obj("No time");
    case 5: return obj("Worried about no-shows");
    case 6: return obj("Wants to know who else is on it");
    case 7: return k.closing[0].text;
    case 8: return k.holdingLine;
    default: return null;
  }
}
function practiceFor157(kit) {
  return ENRICH157 && Array.isArray(ENRICH157.practice)
    ? ENRICH157.practice.map((p) => ({ ...p, answer: practiceAnswer157(kit, p.n) }))
    : [];
}
const PRACTICE157 = practiceFor157(KIT);

// Build -161: Jeff's own Seller Kits. Tony's KIT above stays
// byte-for-byte his (Build -157 pins its words). Jeff sells as
// the founder, in every city his seat holds; his kits clone the
// approved structure and swap the name/city lines only — same
// canon, same order, same do-not-say list. His print kit is
// empty: the printed cards carry Tony's name and code, and Jeff
// has none of his own yet — the Kit screen simply shows no
// print section rather than somebody else's cards.
const jeffKitCache161 = new Map();
function jeffKit161(marketName) {
  const M = marketName || "Hampton Roads";
  if (jeffKitCache161.has(M)) return jeffKitCache161.get(M);
  const k = JSON.parse(JSON.stringify(KIT));
  const swap = (s) => String(s || "").split("Hampton Roads").join(M);
  k.openers[0] = { title: "30-second opener", text: `Hey, I'm Jeff — I run Magpie. Magpie is local influencer marketing: real creators right here in ${M}, whose followers actually live here. We're putting together the founding creator list now, and when we open, local shops will use those creators to get neighbors in the door. Shops like yours are claiming founding spots before we open. Can I show you the creators for two minutes? That's it.` };
  k.openers = k.openers.map((o, i) => (i === 0 ? o : { ...o, text: swap(o.text) }));
  k.objections = k.objections.map((o) => ({ ...o, a: swap(o.a) }));
  k.twoMinute = { title: k.twoMinute.title, paras: (k.twoMinute.paras || []).map((p) => swap(p)) };
  k.faq = (k.faq || []).map((f) => {
    if (/behind Magpie/.test(f.q)) return { q: f.q, a: `Magpie is built by Jeff Rimmer — that's me. I've spent two decades in local media and startups, and most recently I've been leading marketing for large brands and Fortune 100 companies, including influencer marketing at scale. I'm the one who looks after ${M} founding shops day to day.` };
    if (f.q === "What does it cost?") return { q: f.q, a: String(f.a || "").split("ask Tony").join("ask me") };
    return { ...f, a: swap(f.a) };
  });
  k.printKit = [];
  k.holdingLine = "That's my call to make — and I won't guess at it standing here. Let me check it properly and come back to you with an actual answer, not my first instinct.";
  jeffKitCache161.set(M, k);
  return k;
}
function kitFor(seat) {
  if (seat && seat.hqSeat) return jeffKit161(seat.marketName);
  return KIT;
}

// ---------------- Show Mode bench ----------------

const LEAD_CAT_TO_CREATOR_CATS = {
  "Restaurants & Dining": ["Food & Drink"],
  "Bars & Nightlife": ["Nightlife", "Food & Drink"],
  "Health & Aesthetics": ["Health & Wellness", "Fitness & Wellness"],
  "Beauty & Grooming": ["Beauty & Grooming"],
  "Experiences & Attractions": ["Attractions & Events", "Lifestyle"],
  "Retail & Boutiques": ["Retail & Shopping", "Lifestyle"],
};

function reachLine(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  const tenths = Math.round(Number(pct) / 10);
  if (tenths >= 10) return "10 out of 10 of their followers live here";
  if (tenths <= 0) return "Fewer than 1 in 10 of their followers live here";
  return `${tenths} out of 10 of their followers live here`;
}

async function showBench(marketId, leadCategory, leadArea, marketName) {
  const creators = deps.marketCreators ? await deps.marketCreators(marketId) : { bench: [] };
  const bench = creators.bench || [];
  const want = LEAD_CAT_TO_CREATOR_CATS[leadCategory] || [];
  const matched = [], rest = [];
  for (const c of bench) {
    const cats = c.categories || [];
    if (want.some((w) => cats.includes(w))) matched.push(c); else rest.push(c);
  }
  const byPct = (a, b) => (Number(b.localPct) || 0) - (Number(a.localPct) || 0);
  matched.sort(byPct); rest.sort(byPct);
  const tagged = [...matched.slice(0, 4).map((c) => ({ c, inCategory: true })), ...rest.slice(0, Math.max(0, 6 - Math.min(4, matched.length))).map((c) => ({ c, inCategory: false }))].slice(0, 6);
  // Build -156 (honest subset): area framing ONLY from stored
  // facts — a bench creator whose own stored area equals the
  // business's neighborhood, or whose stored city equals the
  // business's city, is "based in" that area. No stored match,
  // no framing: the screen stays exactly as Build -155 shipped,
  // and no distance or proximity is ever claimed.
  const leadNb = String((leadArea && leadArea.neighborhood) || "").trim().toLowerCase();
  const leadCity = String((leadArea && leadArea.city) || "").trim().toLowerCase();
  const areaOf = (c) => {
    const a = String(c.area || "").trim().toLowerCase();
    const city = String(c.city || "").trim().toLowerCase();
    if (leadNb && a && a === leadNb) return String((leadArea && leadArea.neighborhood) || "").trim();
    if (leadCity && city && city === leadCity) return String((leadArea && leadArea.city) || "").trim();
    if (leadNb && city && city === leadNb) return String((leadArea && leadArea.neighborhood) || "").trim();
    return null;
  };
  const cards = tagged.map(({ c, inCategory }) => ({
    firstName: c.firstName || c.name || "",
    name: c.name || "",
    handle: c.handle || "",
    categoryLine: c.community ? `A ${marketName || "Hampton Roads"} ${String((c.categories || [])[0] || "local").toLowerCase()} community` : ((c.categories || [])[0] || "Local creator"),
    reachLine: reachLine(c.localPct),
    reachPct: c.localPct == null ? null : Math.round(Number(c.localPct)),
    neighborCount: typeof c.neighborCount === "number" ? c.neighborCount : null,
    neighborExtrapolated: !!c.neighborExtrapolated,
    photoUrl: c.photoUrl || null,
    inCategory,
    alsoLine: !inCategory && matched.length > 0,
    areaLine: areaOf(c) ? `Based in ${areaOf(c)}` : null,
  }));
  const inArea = cards.filter((c) => c.areaLine && typeof c.neighborCount === "number" && c.neighborCount > 0);
  let areaFraming = null;
  if (inArea.length) {
    const label = inArea[0].areaLine.replace(/^Based in /, "");
    const combined = inArea.reduce((s, c) => s + c.neighborCount, 0);
    if (combined > 0) {
      areaFraming = {
        label,
        count: inArea.length,
        combinedNeighbors: combined,
        anyExtrapolated: inArea.some((c) => c.neighborExtrapolated),
        names: inArea.map((c) => c.firstName || c.name),
      };
    }
  }
  return { cards, areaFraming };
}

// ---------------- one-time seed: Tony's seat + the HR book ----------------

const SEED_FLAG = "config:bdevSeed155";
let seedDone = false;
let seedWaitingLogged = false;
async function maybeSeedBizdev() {
  if (seedDone) return true;
  const flag = await store().get(SEED_FLAG);
  if (flag && flag.done) { seedDone = true; return true; }
  const emailIdx = await store().get("email:tjohnson23462@gmail.com");
  if (!emailIdx || !emailIdx.userId) {
    // Write the waiting note ONCE per process — a store write on
    // every request would invalidate the suggestions memo forever.
    if (!seedWaitingLogged) {
      seedWaitingLogged = true;
      await store().set(SEED_FLAG, { claimedAt: nowIso(), done: false, waitingFor: "tjohnson23462@gmail.com signup" });
    }
    return false; // retry on a later request until the account exists
  }
  await store().set(SEED_FLAG, { claimedAt: nowIso(), done: false, running: true });
  const user = await store().get(`user:${emailIdx.userId}`);
  if (!user) return false;
  let seat = await seatOf(user);
  if (!seat) {
    seat = await assignSeat({ userId: user.id, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HR-TONY", seatState: "probation" });
    await stampUserSeat(user, seat);
  }
  const seed = require("./bizdev-seed-hr.json");
  const existing = await leadsOfMarket("hampton-roads");
  const have = new Set(existing.map((l) => normName(l.name)));
  let created = 0;
  for (const s of seed) {
    if (have.has(normName(s.name))) continue;
    const lead = {
      id: uuid(), marketId: "hampton-roads", marketName: "Hampton Roads", locationId: uuid(),
      assignedRepId: seat.userId, source: "HQ-loaded", championName: null,
      name: s.name, shortName: s.shortName || null, category: s.category, subType: s.subType || "",
      neighborhood: s.neighborhood, city: s.city, address: s.address || null, website: s.website || null,
      dmName: s.dmName || null, dmRole: s.dmRole || null, dmRoleLabel: s.dmRoleLabel || null,
      secondContact: s.secondContact || null, usuallyHere: null,
      phone1: s.phone1 || null, phone1Verify: !!s.phone1Verify, phone1Note: s.phone1Note || null,
      phone2: s.phone2 || null, phone2Verify: !!s.phone2Verify, phone2Note: s.phone2Note || null,
      email: s.email || null, instagram: s.instagram || null,
      hqTier: s.hqTier || "B",
      flags: { doNotContact: false, jeffHandles: false, chain: !!s.chain },
      stage: "Not visited yet",
      stageHistory: [{ stage: "Not visited yet", at: nowIso(), by: "HQ seed" }],
      founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
      attribution: { repCode: "HR-TONY", firstTouchAt: null, source: "HQ-loaded" },
      nextAction: { type: "Visit", date: null, what: "First visit" },
      lastTouch: null, pendingApproval: false, hqDecision: null,
      createdAt: nowIso(), updatedAt: nowIso(),
    };
    lead.masterId = lead.id;
    await store().set(`bdevlead:${lead.id}`, lead);
    created += 1;
  }
  const dncSeed = await dncRecords();
  void dncSeed;
  await store().set(SEED_FLAG, { claimedAt: nowIso(), done: true, seatUserId: seat.userId, leadsCreated: created, at: nowIso() });
  seedDone = true;
  await logEvent({ type: "bdev_seed_155", actorId: null, actorRole: "system", subjectId: seat.userId, market: "Hampton Roads", data: { leadsCreated: created, repCode: "HR-TONY" } });
  return true;
}

// ---------------- Build -157 Phase B: enrichment loader ----------------
// One-time merge of the Phase A pack into the seeded HR book,
// mirroring maybeSeedBizdev's claimed-flag guard. Merges ONLY the
// fields present per lead; stage / stageHistory / logs / founding
// and the contact flags are never touched (the one exception is
// the phone-verify rule: an enrichment phone1Verify/phone2Verify
// of true raises the lead's Verify Before Use flag). Research and
// evidence notes collect into lead.hqResearch — internal-only,
// never on a rep payload.
const ENRICH_FLAG = "config:bdevEnrich157";
let enrich157Done = false;
async function maybeEnrich157() {
  if (enrich157Done) return true;
  const flag = await store().get(ENRICH_FLAG);
  if (flag && flag.done) { enrich157Done = true; return true; }
  const seedFlag = await store().get(SEED_FLAG);
  if (!seedFlag || !seedFlag.done) return false; // the -155 seed must land first; retry later
  if (!ENRICH157 || !Array.isArray(ENRICH157.leads)) return false;
  const leads = await leadsOfMarket("hampton-roads");
  const byName = new Map();
  for (const l of leads) { const k = normName(l.name); if (!byName.has(k)) byName.set(k, l); }
  let leadsUpdated = 0;
  for (const entry of ENRICH157.leads) {
    const lead = byName.get(normName(entry.matchName));
    if (!lead) continue;
    const e = entry.enrichment || {};
    for (const f of ["email", "instagram", "address", "phone1", "phone2", "dmName", "dmRole", "dmRoleLabel"]) {
      if (typeof e[f] === "string" && e[f].length) lead[f] = e[f];
    }
    if (e.secondContact && typeof e.secondContact === "object") lead.secondContact = e.secondContact;
    if (e.phone1Verify === true) lead.phone1Verify = true;
    if (e.phone2Verify === true) lead.phone2Verify = true;
    if (e.phone1Note !== undefined) lead.phone1Note = e.phone1Note;
    if (e.phone2Note !== undefined) lead.phone2Note = e.phone2Note;
    const research = {};
    for (const k of ["note", "emailEvidence", "emailNote", "instagramSource", "instagramNote", "emailVerify"]) {
      if (e[k] !== undefined) research[k] = e[k];
    }
    if (Object.keys(research).length) lead.hqResearch = { ...(lead.hqResearch || {}), ...research };
    if (entry.playbook) lead.playbook = entry.playbook;
    await saveLead(lead);
    leadsUpdated += 1;
  }
  // Pre-warm drafts are Jeff's lane only — stored for HQ, never
  // sent by the app and never on a rep payload.
  let prewarmStored = 0;
  for (const pw of ENRICH157.prewarmDrafts || []) {
    const lead = byName.get(normName(pw.business));
    if (!lead) continue;
    await store().set(`bdevprewarm:${lead.id}`, { leadId: lead.id, business: pw.business, toName: pw.toName, draft: pw.draft, createdAt: nowIso() });
    prewarmStored += 1;
  }
  const at = nowIso();
  await store().set(ENRICH_FLAG, { done: true, at, leadsUpdated, prewarmStored });
  enrich157Done = true;
  await logEvent({ type: "bdev_enrich_157", actorId: null, actorRole: "system", subjectId: null, market: "Hampton Roads", data: { leadsUpdated, prewarmStored } });
  return true;
}

// ---------------- HQ load 2026-11-09: destination targets ----------------
// One-time, claimed-flag-guarded load of the destination pack
// (bizdev-load-dest-2026-11-09.json — Busch Gardens Williamsburg,
// Jeff's order 2026-11-09: "Add it to his target") into Tony's HR
// book, mirroring maybeSeedBizdev's record shape exactly. Creates
// ONLY leads whose normalized names are not already in the market,
// and each pack entry carries a fixed id, so a re-run can never
// duplicate. Existing leads are never read for update here — stage,
// logs, founding and flags of the working book stay untouched.
// Waits for the -155 seed (the seat + book must exist first).
const DEST_LOAD_FLAG = "config:bdevLoadDest20261109";
let destLoadDone = false;
async function maybeLoadDest20261109() {
  if (destLoadDone) return true;
  const flag = await store().get(DEST_LOAD_FLAG);
  if (flag && flag.done) { destLoadDone = true; return true; }
  const seedFlag = await store().get(SEED_FLAG);
  if (!seedFlag || !seedFlag.done) return false; // the -155 seed must land first; retry later
  if (!DEST2026 || !Array.isArray(DEST2026.leads)) return false;
  const seats = (await store().list("bdevrep:")).map((r) => r.value).filter((v) => v && v.active && v.repCode === (DEST2026.repCode || "HR-TONY"));
  const seat = seats[0];
  if (!seat) return false;
  await store().set(DEST_LOAD_FLAG, { claimedAt: nowIso(), done: false, running: true });
  const existing = await leadsOfMarket("hampton-roads");
  const have = new Set(existing.map((l) => normName(l.name)));
  let created = 0;
  for (const s of DEST2026.leads) {
    if (!s.id || have.has(normName(s.name))) continue;
    const lead = {
      id: s.id, marketId: "hampton-roads", marketName: "Hampton Roads", locationId: uuid(),
      assignedRepId: seat.userId, source: "HQ-loaded", championName: null,
      name: s.name, shortName: s.shortName || null, category: s.category, subType: s.subType || "",
      neighborhood: s.neighborhood, city: s.city, address: s.address || null, website: s.website || null,
      dmName: s.dmName || null, dmRole: s.dmRole || null, dmRoleLabel: s.dmRoleLabel || null,
      secondContact: s.secondContact || null, usuallyHere: null,
      phone1: s.phone1 || null, phone1Verify: !!s.phone1Verify, phone1Note: s.phone1Note || null,
      phone2: s.phone2 || null, phone2Verify: !!s.phone2Verify, phone2Note: s.phone2Note || null,
      email: s.email || null, instagram: s.instagram || null,
      hqTier: s.hqTier || "B",
      flags: { doNotContact: false, jeffHandles: false, chain: !!s.chain },
      deskLead: !!s.deskLead,
      stage: "Not visited yet",
      stageHistory: [{ stage: "Not visited yet", at: nowIso(), by: "HQ load (destination)" }],
      founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
      attribution: { repCode: seat.repCode || "HR-TONY", firstTouchAt: null, source: "HQ-loaded" },
      nextAction: s.nextAction || { type: "Email", date: null, what: "First touch" },
      lastTouch: null, pendingApproval: false, hqDecision: null,
      playbook: s.playbook || null,
      hqResearch: s.research || null,
      createdAt: nowIso(), updatedAt: nowIso(),
    };
    lead.masterId = lead.id;
    await store().set(`bdevlead:${lead.id}`, lead);
    created += 1;
  }
  await store().set(DEST_LOAD_FLAG, { claimedAt: nowIso(), done: true, at: nowIso(), leadsCreated: created });
  destLoadDone = true;
  await logEvent({ type: "bdev_load_dest_20261109", actorId: null, actorRole: "system", subjectId: seat.userId, market: "Hampton Roads", data: { leadsCreated: created, repCode: seat.repCode || "HR-TONY" } });
  return true;
}

// ---------------- Build -157: queue, trips, alarms, scoreboard ----------------

async function benchCreators157(marketId) {
  const creators = deps.marketCreators ? await deps.marketCreators(marketId) : { bench: [] };
  return creators.bench || [];
}

// The creators a rep can honestly show this business: the bench
// filtered to the creator categories this lead's category maps
// to (same map Show Mode uses).
function creatorsToShow(lead, bench) {
  const want = LEAD_CAT_TO_CREATOR_CATS[lead.category] || [];
  return (bench || []).filter((c) => (c.categories || []).some((cat) => want.includes(cat)));
}

const QUEUE_CLOSED_STAGES = ["Said no", "Not a fit", "Founding spot claimed"];
function queueCandidates(leads) {
  return (leads || []).filter((l) => {
    if (QUEUE_CLOSED_STAGES.includes(l.stage)) return false;
    const st = statusOf(l);
    if (st === "Declined" || st === "Closed") return false;
    if (l.flags && (l.flags.doNotContact || l.flags.jeffHandles)) return false;
    return true;
  });
}

function queueScore157(lead, bench, today) {
  let score = 0;
  const why = [];
  if (lead.source === "Champion intro" || lead.warmIntro) { score += 100; why.push("Warm intro — these go first"); }
  const overdue = !!(lead.nextAction && lead.nextAction.date && lead.nextAction.date < today);
  if (overdue) { score += 40; why.push("Their follow-up is late"); }
  if (lead.dmName) { score += 25; why.push("Owner's name is on file"); }
  if (lead.phone1 || lead.phone2 || lead.email || lead.instagram) { score += 15; why.push("Easy to reach"); }
  if (creatorsToShow(lead, bench).length) { score += 15; why.push("Creators to show them"); }
  if (lead.hqTier === "A") { score += 12; why.push("Top of Jeff's list"); }
  else if (lead.hqTier === "B") { score += 6; }
  if (lead.stage === "Not visited yet") { score += 4; }
  return { score, why: why.length ? why.join(", ") : "In your book, ready when you are" };
}

function buildQueue157(leads, bench) {
  const today = todayStr();
  const scored = queueCandidates(leads).map((l) => {
    const s = queueScore157(l, bench, today);
    return { lead: l, score: s.score, why: s.why };
  });
  scored.sort((a, b) => b.score - a.score || String(a.lead.name).localeCompare(String(b.lead.name)));
  return scored.map((it, i) => ({
    lead: repLeadPayload(it.lead),
    label: i <= 2 ? "Start here" : i <= 9 ? "Next up" : "Later",
    why: it.why,
  }));
}

const WORKING_STAGES157 = ["Not visited yet", "Visited — owner not in", "Talked — needs to think", "Talked — wants a follow-up"];
function buildTrips157(leads, bench) {
  const today = todayStr();
  const cand = queueCandidates(leads);
  const candIds = new Set(cand.map((l) => l.id));
  const extra = (leads || []).filter((l) => !candIds.has(l.id)
    && l.nextAction && l.nextAction.date && l.nextAction.date <= today
    && WORKING_STAGES157.includes(l.stage));
  const actionable = [...cand, ...extra];
  const byZone = new Map();
  for (const l of actionable) {
    const z = l.neighborhood || "Other area";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push(l);
  }
  const groups = [...byZone.entries()].map(([zone, items]) => {
    const scored = items.map((l) => ({ l, s: queueScore157(l, bench, today).score }))
      .sort((a, b) => b.s - a.s || String(a.l.name).localeCompare(String(b.l.name)));
    const first = scored[0].l;
    return {
      zone,
      city: first.city || "",
      count: items.length,
      dueCount: items.filter((l) => l.nextAction && l.nextAction.date && l.nextAction.date <= today).length,
      warmCount: items.filter((l) => l.source === "Champion intro" || l.warmIntro).length,
      first: repLeadPayload(first),
      leads: scored.map((x) => repLeadPayload(x.l)),
    };
  });
  groups.sort((a, b) => b.dueCount - a.dueCount || b.warmCount - a.warmCount || b.count - a.count
    || zoneRank(a.zone) - zoneRank(b.zone) || a.zone.localeCompare(b.zone));
  return groups;
}

function alarmsFor157(leads) {
  const today = todayStr();
  return (leads || [])
    .filter((l) => l.nextAction && l.nextAction.date && l.nextAction.date < today
      && !QUEUE_CLOSED_STAGES.includes(l.stage)
      && !(l.flags && (l.flags.doNotContact || l.flags.jeffHandles)))
    .sort((a, b) => String(a.nextAction.date).localeCompare(String(b.nextAction.date)))
    .slice(0, 5)
    .map((l) => {
      const date = l.nextAction.date;
      const late = daysLateWords(date);
      return {
        leadId: l.id, name: l.name, dueDate: date, late,
        line: `${l.name} is still waiting — the follow-up was due ${date} (${late}). A quick call or visit keeps it warm.`,
      };
    });
}

// The last completed Mon–Sun week (UTC), as date strings.
function weekWindow(now) {
  const d = now ? new Date(now) : new Date();
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(base).getUTCDay();
  const thisMonday = base - ((dow + 6) % 7) * 86400000;
  return {
    monday: new Date(thisMonday - 7 * 86400000).toISOString().slice(0, 10),
    sunday: new Date(thisMonday - 86400000).toISOString().slice(0, 10),
  };
}

const SCOREBOARD_FOLLOWUP_OUTCOMES = ["Very interested — set a follow-up", "Talked — needs to think", "Talked to staff — need the owner"];
function scoreKey161(seat, monday) { return `bdevscore:${seat.userId}:${seat.marketId}:${monday}`; }
async function computeScoreboard(seat, now) {
  const nowDate = now ? new Date(now) : new Date();
  const { monday, sunday } = weekWindow(nowDate);
  const key = scoreKey161(seat, monday);
  const existing = await store().get(key);
  if (existing) return existing;
  const inWindow = (iso) => { const d = String(iso || "").slice(0, 10); return d >= monday && d <= sunday; };
  const logs = (await store().list("bdevlog:")).map((r) => r.value)
    .filter((v) => v && v.repId === seat.userId && v.outcome && inWindow(v.visitAt || v.createdAt));
  const visits = logs.length;
  const followUpsSet = logs.filter((v) => SCOREBOARD_FOLLOWUP_OUTCOMES.includes(v.outcome)).length;
  const leads = (await leadsOfMarket(seat.marketId)).filter((l) => l.assignedRepId === seat.userId);
  const claims = leads.filter((l) => l.founding && l.founding.claimedAt && inWindow(l.founding.claimedAt)).length;
  const today = nowDate.toISOString().slice(0, 10);
  const overdueNow = leads.filter((l) => l.nextAction && l.nextAction.date && l.nextAction.date < today
    && !QUEUE_CLOSED_STAGES.includes(l.stage)).length;
  const objCounts = {};
  for (const v of logs) for (const o of v.objections || []) objCounts[o] = (objCounts[o] || 0) + 1;
  let topObjection = null, topN = 0;
  for (const [o, n] of Object.entries(objCounts)) { if (n > topN) { topN = n; topObjection = o; } }
  const lines = [];
  if (!visits && !claims && !topObjection && !overdueNow) {
    lines.push("A quiet week — the book is still there, in order, whenever you've got time.");
  } else {
    lines.push(`Last week: ${visits} visit${visits === 1 ? "" : "s"} logged, ${claims} founding spot${claims === 1 ? "" : "s"} claimed.`);
    if (topObjection) lines.push(`The pushback heard most: ${topObjection}.`);
    if (overdueNow) lines.push(overdueNow === 1 ? "1 follow-up is overdue right now." : `${overdueNow} follow-ups are overdue right now.`);
  }
  const rec = {
    id: uuid(), repId: seat.userId, marketId: seat.marketId, weekOf: monday,
    createdAt: nowDate.toISOString(),
    stats: { visits, claims, followUpsSet, overdueNow, topObjection },
    lines,
  };
  await store().set(key, rec);
  return rec;
}

async function latestScoreboard157(repId, marketId) {
  const rows = (await store().list("bdevscore:")).map((r) => r.value)
    .filter((v) => v && v.repId === repId && (!marketId || !v.marketId || v.marketId === marketId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const latest = rows[0] || null;
  if (!latest) return null;
  const age = Date.now() - Date.parse(latest.createdAt);
  return Number.isFinite(age) && age <= 8 * 86400000 ? latest : null;
}

// ---------------- Build -161: Jeff's own seller seat + Nashville ----------------
// Jeff sells too — as an extension of his admin login, never a
// second account. One-time loader in the seed/enrich pattern;
// every step is idempotent, so a deploy re-run converges instead
// of duplicating:
//   1. The super admin (Jeff) gets a real rep seat: HQ-JEFF,
//      active, flagged hqSeat (no commission liability accrues on
//      it — see liability()), holding two markets: Hampton Roads
//      + Nashville.
//   2. Hampton Roads: Jeff's book is his OWN working copy of each
//      HR lead — same intel, playbook and research, fresh working
//      state. Tony's records are never touched; copies link back
//      via masterId (the master lead's id), so a lead HQ adds to
//      Tony's book later still reaches Jeff's book on a re-run.
//   3. Nashville: the 57 stored business targets load as Jeff's
//      Nashville book with their -157-pattern playbooks.
const JEFF_SEAT_FLAG = "config:bdevJeffSeat161";
let jeffSeatDone161 = false;
async function maybeLoadJeffSeat161() {
  if (jeffSeatDone161) return true;
  const seedFlag = await store().get(SEED_FLAG);
  if (!seedFlag || !seedFlag.done) return false; // Tony's book first; HR copies read it
  const users = deps.allUsers ? await deps.allUsers() : [];
  const envAdmin = String(process.env.ADMIN_EMAIL || "").toLowerCase();
  const admins = users.filter((u) => u && u.role === "admin" && (!u.adminPerms || u.adminPerms.super));
  let jeff = admins.find((u) => envAdmin && String(u.email || "").toLowerCase() === envAdmin) || null;
  if (!jeff && admins.length === 1) jeff = admins[0];
  if (!jeff) return false; // ambiguous or absent — never guess whose account this is
  const flag = (await store().get(JEFF_SEAT_FLAG)) || {};
  if (!flag.claimedAt) await store().set(JEFF_SEAT_FLAG, { ...flag, claimedAt: nowIso() });

  // 1. The seat.
  let seat = await seatOf(jeff);
  if (!seat || seat.repCode !== "HQ-JEFF") {
    seat = await assignSeat({ userId: jeff.id, marketId: "hampton-roads", marketName: "Hampton Roads", repCode: "HQ-JEFF", seatState: "active" });
  }
  seat.markets = [
    { marketId: "hampton-roads", marketName: "Hampton Roads" },
    { marketId: "nashville", marketName: "Nashville" },
  ];
  seat.hqSeat = true;
  seat.seatState = "active";
  seat.active = true;
  await store().set(`bdevrep:${jeff.id}`, seat);
  jeff.bizdevSeat = { active: true, marketId: seat.marketId, marketName: seat.marketName, repCode: "HQ-JEFF", markets: seat.markets, hqSeat: true };
  await store().set(`user:${jeff.id}`, jeff);

  // 2. Hampton Roads working copies (idempotent on masterId).
  const hrAll = await leadsOfMarket("hampton-roads");
  const sources = hrAll.filter((l) => l.assignedRepId !== jeff.id);
  const mine = hrAll.filter((l) => l.assignedRepId === jeff.id);
  const mineByMaster = new Map(mine.map((l) => [l.masterId, l]));
  let hrCopied = 0, hrPlaybooksFilled = 0;
  for (const src of sources) {
    const existing = mineByMaster.get(src.id);
    if (existing) {
      if (!existing.playbook && src.playbook) { existing.playbook = src.playbook; existing.updatedAt = nowIso(); await saveLead(existing); hrPlaybooksFilled++; }
      continue;
    }
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uuid();
    copy.assignedRepId = jeff.id;
    copy.masterId = src.id;
    copy.source = "HQ-loaded";
    copy.stage = "Not visited yet";
    copy.stageHistory = [{ stage: "Not visited yet", at: nowIso(), by: "HQ — Jeff's book" }];
    delete copy.status;
    copy.statusHistory = [];
    copy.founding = { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null };
    copy.attribution = { repCode: "HQ-JEFF", firstTouchAt: null, source: "HQ-loaded" };
    copy.nextAction = { type: "Visit", date: null, what: "First visit" };
    copy.lastTouch = null;
    copy.pendingApproval = false;
    copy.hqDecision = null;
    copy.isNewForRep = false;
    copy.hasStorefrontPhoto = false;
    copy.flags = { doNotContact: !!(src.flags && src.flags.doNotContact), jeffHandles: false, chain: !!(src.flags && src.flags.chain) };
    copy.createdAt = nowIso();
    copy.updatedAt = nowIso();
    await store().set(`bdevlead:${copy.id}`, copy);
    hrCopied++;
  }

  // 3. Nashville — the stored targets + their playbooks.
  let nashSeed = null, nashEnrich = null;
  try { nashSeed = require("./bizdev-seed-nashville.json"); } catch (e) { nashSeed = null; }
  try { nashEnrich = require("./bizdev-enrich-nashville.json"); } catch (e) { nashEnrich = null; }
  let nashLoaded = 0, nashPlaybooks = 0;
  if (Array.isArray(nashSeed)) {
    const pbByName = new Map((((nashEnrich && nashEnrich.leads) || [])).map((e) => [normName(e.matchName), e]));
    const existingN = await leadsOfMarket("nashville");
    const mineByName = new Map(existingN.filter((l) => l.assignedRepId === jeff.id).map((l) => [normName(l.name), l]));
    for (const s of nashSeed) {
      const entry = pbByName.get(normName(s.name));
      const cur = mineByName.get(normName(s.name));
      if (cur) {
        if (!cur.playbook && entry && entry.playbook) { cur.playbook = entry.playbook; cur.updatedAt = nowIso(); await saveLead(cur); nashPlaybooks++; }
        continue;
      }
      const lead = {
        id: uuid(), marketId: "nashville", marketName: "Nashville", locationId: uuid(), masterId: null,
        assignedRepId: jeff.id, source: "HQ-loaded", championName: null,
        name: s.name, shortName: s.shortName || null, category: s.category, subType: s.subType || "",
        neighborhood: s.neighborhood || "", city: s.city || "Nashville", address: s.address || null,
        website: s.website || null, websiteNote: s.websiteNote || null,
        dmName: s.dmName || null, dmRole: s.dmRole || null, dmRoleLabel: s.dmRoleLabel || null,
        secondContact: s.secondContact || null, usuallyHere: s.usuallyHere || null,
        phone1: s.phone1 || null, phone1Verify: !!s.phone1Verify, phone1Note: s.phone1Note || null,
        phone2: s.phone2 || null, phone2Verify: !!s.phone2Verify, phone2Note: s.phone2Note || null,
        email: s.email || null, emailNote: s.emailNote || null, emailEvidence: s.emailEvidence || null,
        instagram: s.instagram || null, instagramNote: s.instagramNote || null,
        hqTier: s.hqTier || "B",
        flags: { doNotContact: false, jeffHandles: false, chain: !!s.chain },
        stage: "Not visited yet", stageHistory: [{ stage: "Not visited yet", at: nowIso(), by: "HQ-loaded" }],
        founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
        attribution: { repCode: "HQ-JEFF", firstTouchAt: null, source: "HQ-loaded" },
        nextAction: { type: "Visit", date: null, what: "First visit" }, lastTouch: null,
        pendingApproval: false, hqDecision: null, isNewForRep: false,
        createdAt: nowIso(), updatedAt: nowIso(),
      };
      lead.masterId = lead.id;
      if (entry) {
        if (entry.playbook) { lead.playbook = entry.playbook; nashPlaybooks++; }
        const en = entry.enrichment || {};
        const research = {};
        for (const k of ["note", "emailEvidence", "emailNote", "instagramSource", "instagramNote", "emailVerify"]) {
          if (en[k] != null && en[k] !== "") research[k] = en[k];
        }
        if (Object.keys(research).length) lead.hqResearch = research;
        for (const k of ["dmName", "dmRole", "dmRoleLabel", "secondContact", "usuallyHere", "phone1", "phone1Verify", "phone1Note", "phone2", "phone2Verify", "phone2Note", "email", "emailNote", "emailEvidence", "website", "websiteNote", "instagram", "instagramNote"]) {
          if (en[k] !== undefined) lead[k] = en[k];
        }
      }
      await store().set(`bdevlead:${lead.id}`, lead);
      nashLoaded++;
    }
  }
  await store().set(JEFF_SEAT_FLAG, { ...flag, done: true, doneAt: nowIso(), hrCopied, nashvilleLoaded: nashLoaded });
  await logEvent({ type: "bdev_jeff_seat_161", actorId: jeff.id, actorRole: "admin", subjectId: jeff.id, market: "Hampton Roads", data: { hrCopied, nashvilleLoaded: nashLoaded } });
  jeffSeatDone161 = true;
  return true;
}

// The daily sweep (POST /admin/bdev/sweep): one alarm record per
// rep per day while follow-ups sit overdue (same-day overwrite =
// idempotent), plus Monday scoreboards for the week just ended.
async function runBizdevSweep(opts) {
  const now = opts && opts.now ? new Date(opts.now) : new Date();
  const today = now.toISOString().slice(0, 10);
  const seats = (await store().list("bdevrep:")).map((r) => r.value).filter((v) => v && v.active);
  let alarmsWritten = 0, scoreboardsWritten = 0;
  for (const seat of seats) {
    const leads = (await leadsOfMarket(seat.marketId)).filter((l) => l.assignedRepId === seat.userId);
    const overdue = leads
      .filter((l) => l.nextAction && l.nextAction.date && l.nextAction.date < today
        && !QUEUE_CLOSED_STAGES.includes(l.stage)
        && !(l.flags && (l.flags.doNotContact || l.flags.jeffHandles)))
      .sort((a, b) => String(a.nextAction.date).localeCompare(String(b.nextAction.date)));
    if (overdue.length) {
      await store().set(`bdevalarm:${seat.userId}:${today}`, {
        repId: seat.userId, marketId: seat.marketId, date: today,
        items: overdue.map((l) => ({ leadId: l.id, name: l.name, dueDate: l.nextAction.date })),
        createdAt: now.toISOString(),
      });
      alarmsWritten += 1;
    }
    if (now.getUTCDay() === 1) {
      const { monday } = weekWindow(now);
      const existed = await store().get(scoreKey161(seat, monday));
      await computeScoreboard(seat, now);
      if (!existed) scoreboardsWritten += 1;
    }
  }
  return { seats: seats.length, alarmsWritten, scoreboardsWritten };
}

// The rep Home payload, factored out of the route so HQ's
// read-only preview (Build -157) renders EXACTLY what the rep
// sees. opts.lazyScoreboard === false (the preview) suppresses
// the one write this builder can make — the Monday scoreboard
// generation — keeping preview paths write-free.
async function buildRepHome157(seat, user, opts) {
  const plan = await dayPlan(seat);
  const progress = await marketProgress(seat.marketId);
  const leads = (await leadsOfMarket(seat.marketId)).filter((l) => l.assignedRepId === seat.userId);
  const today = todayStr();
  const followUps = leads
    .filter((l) => l.nextAction && l.nextAction.date && l.nextAction.date <= today && !["Said no", "Not a fit"].includes(l.stage))
    .sort((a, b) => String(a.nextAction.date).localeCompare(String(b.nextAction.date)))
    .map((l) => repLeadPayload(l));
  const newLeads = leads.filter((l) => l.isNewForRep).map((l) => repLeadPayload(l));
  const logs = (await store().list("bdevlog:")).map((r) => r.value).filter((v) => v && v.repId === seat.userId);
  const weekAgo = addDaysStr(today, -6);
  const visitsThisWeek = logs.filter((v) => v.visitAt && v.visitAt.slice(0, 10) >= weekAgo && v.outcome).length;
  const money = await moneyFor(seat.userId, seat.marketId);
  const unfinished = logs.filter((v) => v.open).map((v) => ({ logId: v.id, leadId: v.leadId, visitAt: v.visitAt }));
  const firstStop = plan.stops.find((s) => !logs.some((v) => v.leadId === s.id && v.visitAt && v.visitAt.slice(0, 10) === today && v.outcome));
  const brief = [];
  brief.push(plan.zoneLabel ? `Today: ${plan.zoneLabel}. ${plan.totalCount} stop${plan.totalCount === 1 ? "" : "s"}.` : "No visits planned today — pick a neighborhood or check new leads.");
  if (firstStop) brief.push(`First: ${firstStop.shortName || firstStop.name}${firstStop.dmName ? ` — ask for ${firstStop.dmName}` : ""}.`);
  brief.push(followUps.length ? `${followUps.length} follow-up${followUps.length === 1 ? "" : "s"} due.` : "No follow-ups due.");
  const bench = await benchCreators157(seat.marketId);
  const queue = buildQueue157(leads, bench).slice(0, 8);
  const alarms = alarmsFor157(leads);
  if (!opts || opts.lazyScoreboard !== false) {
    if (new Date().getUTCDay() === 1) await computeScoreboard(seat, new Date());
  }
  const scoreboard = await latestScoreboard157(seat.userId, seat.marketId);
  return {
    rep: { firstName: String(user.name || "").split(" ")[0] || "Rep", marketName: seat.marketName, marketId: seat.marketId, markets: seatMarkets(seat), hqSeat: !!seat.hqSeat, repCode: seat.repCode, seatState: seat.seatState, pinSet: !!seat.pinHash },
    date: today, brief,
    plan: { zoneLabel: plan.zoneLabel, stops: plan.stops, doneCount: plan.doneCount, totalCount: plan.totalCount, clusters: plan.clusters },
    followUps, newLeads, progress,
    numbers: { claimedThisMonth: leads.filter((l) => l.founding && l.founding.claimedAt && monthOf(l.founding.claimedAt) === monthOf(nowIso())).length, visitsThisWeek, moneyBuilding: money.accrued },
    unfinished,
    alarms, queue, scoreboard,
  };
}

// The My Money payload, factored out of the route for the same
// preview-reuse reason as buildRepHome157. Read-only.
async function moneyPayload157(seat) {
  const money = await moneyFor(seat.userId, seat.marketId);
  const leads = (await leadsOfMarket(seat.marketId)).filter((l) => l.assignedRepId === seat.userId);
  const pipeline = leads.filter((l) => (l.founding && (l.founding.status === "Claimed" || l.founding.status === "Confirmed")) || (l.stage || "").startsWith("Very interested"))
    .map((l) => ({ name: l.name, status: l.founding && l.founding.status !== "Not claimed" ? l.founding.status : "Interested", plan: (l.founding && l.founding.planInterest) || null, claimedAt: (l.founding && l.founding.claimedAt) || null }));
  const pipelineValue = pipeline.reduce((n, p) => n + (p.plan || BLENDED_MONTHLY) * 0.25, 0);
  const nextTier = money.rateNow.kept < 25
    ? { at: 25, rate: 30, have: money.rateNow.kept }
    : money.rateNow.kept < 75 ? { at: 75, rate: 35, have: money.rateNow.kept } : null;
  return {
    money: {
      accrued: money.accrued, ratePct: Math.round(money.rateNow.rate * 100), kept: money.rateNow.kept,
      shrank: money.rateNow.shrank, kicked: money.rateNow.kicked,
      newThisMonth: newActivationsIn((await activationsOf(seat.userId, seat.marketId)).filter((a) => a.direct), monthOf(nowIso())).length,
      vesting: money.vesting, perBusiness: money.perBusiness, residualCount: money.residualCount,
    },
    pipeline, pipelineMonthlyIfActive: Math.round(pipelineValue * 100) / 100,
    nextTier, seatState: seat.seatState, warningMonth: seat.warningMonth || null, atRisk: seat.atRisk || null,
    // Build -161: Jeff's HQ seat reads its own book here — the
    // client labels it as his and drops the commission framing.
    hqSeat: !!seat.hqSeat, marketName: seat.marketName, seat: seatSummary(seat),
  };
}

async function previewSeat157(repId) {
  const seat = repId ? await store().get(`bdevrep:${repId}`) : null;
  return seat && seat.active ? seat : null;
}
async function userRecord157(userId) {
  if (deps.allUsers) {
    const users = await deps.allUsers();
    const u = (users || []).find((x) => x && x.id === userId);
    if (u) return u;
  }
  return (await store().get(`user:${userId}`)) || { id: userId, name: "" };
}

// ---------------- rep API ----------------

async function repSeatOrErr(user) {
  const seat = await seatOf(user);
  if (!seat) return { error: err(403, "No biz dev seat on this account.") };
  return { seat };
}

async function handleBizdevApi({ user, seg, method, event, query }) {
  // Public founding claim (no auth): POST /bdev/claim
  if (method === "POST" && seg[1] === "claim" && seg.length === 2) return publicClaim(event);
  // Public claim-page prefill: the business name behind a rep's
  // claim link (the rep handed this link to that business).
  if (method === "GET" && seg[1] === "claim-info" && seg.length === 2) {
    const lead = await getLead(String((query && query.lead) || ""));
    if (!lead) return json(200, { businessName: null });
    return json(200, { businessName: lead.name, marketName: lead.marketName || "Hampton Roads" });
  }

  if (!user) return err(401, "Sign in first.");
  const { seat, error } = await repSeatOrErr(user);
  if (error) return error;
  const b = method === "POST" ? parseBody(event) : {};

  // Build -161: a multi-market seat picks its working city with
  // ?mkt= (or body mkt), validated against the seat's own markets
  // here in the data layer — a market the seat doesn't hold does
  // not exist for this session. The PIN block below still uses the
  // real seat record (one PIN per person, every city).
  const reqMkt161 = String((query && query.mkt) || b.mkt || "");
  let effSeat = seat;
  if (reqMkt161 && reqMkt161 !== effSeat.marketId) {
    effSeat = effectiveSeat(seat, reqMkt161);
    if (!effSeat) return err(400, "That city isn't in your book.");
  }
  // Build -161 fix: the working city is a SEAT-level preference,
  // not a per-device one — a rep who flips to Nashville at the
  // desk finds Nashville on the phone. An explicit ?mkt= (already
  // validated against the seat's own markets above) is
  // remembered on the seat record; a request with no ?mkt=
  // falls back to the remembered city, validated the same way.
  if (reqMkt161 && seatHasMarket(seat, reqMkt161)) {
    if (seat.lastMarketId !== reqMkt161) {
      seat.lastMarketId = reqMkt161;
      await store().set(`bdevrep:${seat.userId}`, seat);
    }
  } else if (!reqMkt161 && seat.lastMarketId && seat.lastMarketId !== seat.marketId) {
    const remembered = effectiveSeat(seat, seat.lastMarketId);
    if (remembered) effSeat = remembered;
  }

  // GET /bdev/home — the payload builder is shared with HQ's
  // read-only preview (buildRepHome157); behavior is unchanged
  // apart from the Build -157 additions (alarms, queue, scoreboard).
  if (method === "GET" && seg[1] === "home" && seg.length === 2) {
    return json(200, await buildRepHome157(effSeat, user));
  }

  // GET /bdev/queue — the priority queue over the rep's own book.
  if (method === "GET" && seg[1] === "queue" && seg.length === 2) {
    const book = (await leadsOfMarket(effSeat.marketId)).filter((l) => l.assignedRepId === seat.userId);
    const bench = await benchCreators157(effSeat.marketId);
    return json(200, { queue: buildQueue157(book, bench) });
  }

  // GET /bdev/trips — the same actionable book, grouped into
  // drive areas (neighborhoods) so a trip never crisscrosses.
  if (method === "GET" && seg[1] === "trips" && seg.length === 2) {
    const book = (await leadsOfMarket(effSeat.marketId)).filter((l) => l.assignedRepId === seat.userId);
    const bench = await benchCreators157(effSeat.marketId);
    return json(200, { trips: buildTrips157(book, bench) });
  }

  // GET /bdev/leads?q=&filter=&city=&neighborhood=
  if (method === "GET" && seg[1] === "leads" && seg.length === 2) {
    let leads = (await leadsOfMarket(effSeat.marketId)).filter((l) => l.assignedRepId === seat.userId);
    // Build -157: filter facets come from the rep's whole book
    // (before any filter), so the pickers never narrow themselves
    // away. City + neighborhood are plain equality filters.
    const facets = {
      cities: [...new Set(leads.map((l) => l.city || "").filter(Boolean))].sort(),
      neighborhoods: [...new Map(leads.filter((l) => l.neighborhood).map((l) => [`${l.neighborhood}|${l.city || ""}`, { name: l.neighborhood, city: l.city || "" }])).values()]
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
    const cityF = String((query && query.city) || "");
    const nbF = String((query && query.neighborhood) || "");
    if (cityF) leads = leads.filter((l) => (l.city || "") === cityF);
    if (nbF) leads = leads.filter((l) => (l.neighborhood || "") === nbF);
    const q = String((query && query.q) || "").toLowerCase();
    const filter = String((query && query.filter) || "all");
    const today = todayStr();
    if (q) leads = leads.filter((l) => [l.name, l.neighborhood, l.category].join(" ").toLowerCase().includes(q));
    if (filter === "due") leads = leads.filter((l) => l.nextAction && l.nextAction.date && l.nextAction.date <= today);
    else if (filter === "notvisited") leads = leads.filter((l) => l.stage === "Not visited yet");
    else if (filter === "thinking") leads = leads.filter((l) => ["Talked — needs to think", "Talked — wants a follow-up", "Visited — owner not in"].includes(l.stage));
    else if (filter === "claimed") leads = leads.filter((l) => l.stage === STAGE_CLAIMED);
    else if (filter === "checked") leads = leads.filter((l) => l.hqDecision && l.hqDecision.decision === "rejected");
    leads.sort((a, b) => String((a.nextAction && a.nextAction.date) || "9999").localeCompare(String((b.nextAction && b.nextAction.date) || "9999")));
    // Viewing the list clears the "new" badge.
    for (const l of leads) if (l.isNewForRep) { l.isNewForRep = false; await saveLead(l); }
    return json(200, { leads: leads.map((l) => repLeadPayload(l)), facets, seat: seatSummary(effSeat) });
  }

  // POST /bdev/leads — rep adds a lead (work now, counts after Jeff approves)
  if (method === "POST" && seg[1] === "leads" && seg.length === 2) {
    const name = String(b.name || "").trim();
    if (!name) return err(400, "The business needs a name.");
    if (!CATEGORIES.includes(b.category)) return err(400, "Pick the business kind from the list.");
    const candidate = {
      marketId: effSeat.marketId, name, neighborhood: String(b.neighborhood || "").trim(),
      phone1: b.phone || null, instagram: b.instagram || null, email: b.email || null,
    };
    const marketLeads = await leadsOfMarket(effSeat.marketId);
    const global = await allLeads();
    const dup = await dupCheck(marketLeads, global, candidate, null);
    if (dup.hard) {
      if (dup.inMarket && dup.hard.assignedRepId === seat.userId) return json(200, { duplicate: "own", leadId: dup.hard.id, message: "This business is already in your book." });
      return json(200, { duplicate: "taken", message: "This business is already on Magpie — Jeff's team has it." });
    }
    if (dup.soft) {
      return json(200, { duplicate: "soft", message: "A business with this name is already in this neighborhood. If it's the same one, open that record. If it's a different business, Jeff will check it.", existingId: dup.soft.id });
    }
    const lead = {
      id: uuid(), marketId: effSeat.marketId, marketName: effSeat.marketName, locationId: uuid(), masterId: null,
      assignedRepId: seat.userId, source: "Added by rep", championName: null,
      name, shortName: null, category: b.category, subType: String(b.subType || ""),
      neighborhood: candidate.neighborhood, city: String(b.city || ""), address: b.address || null, website: null,
      dmName: null, dmRole: null, dmRoleLabel: null, secondContact: null, usuallyHere: null,
      phone1: candidate.phone1, phone1Verify: false, phone1Note: null, phone2: null, phone2Verify: false, phone2Note: null,
      email: candidate.email, instagram: candidate.instagram,
      hqTier: "B", flags: { doNotContact: false, jeffHandles: false, chain: false },
      stage: "Not visited yet", stageHistory: [{ stage: "Not visited yet", at: nowIso(), by: "Rep added" }],
      founding: { status: "Not claimed", claimedAt: null, claimedVia: null, confirmedAt: null, planInterest: null },
      attribution: { repCode: seat.repCode, firstTouchAt: null, source: "Added by rep" },
      nextAction: { type: "Visit", date: null, what: "First visit" }, lastTouch: null,
      pendingApproval: true, hqDecision: null, isNewForRep: false,
      createdAt: nowIso(), updatedAt: nowIso(),
    };
    lead.masterId = lead.id;
    const dncHit = await dncHitFor(lead, await dncRecords());
    if (dncHit) lead.flags.doNotContact = true;
    await store().set(`bdevlead:${lead.id}`, lead);
    await logCapture({ type: "bdev_lead_added", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: effSeat.marketName, data: { source: "Added by rep" } });
    return json(200, { lead: repLeadPayload(lead, { full: true }) });
  }

  // Lead-scoped routes
  if (seg[1] === "leads" && seg.length >= 3) {
    const lead = await getLead(seg[2]);
    if (!lead || lead.marketId !== effSeat.marketId) return err(404, "Not in your market — ask HQ.");
    if (lead.assignedRepId !== seat.userId) return err(404, "That lead isn't in your book.");

    if (method === "GET" && seg.length === 3) {
      const logs = await allLogs(lead.id);
      return json(200, { lead: repLeadPayload(lead, { full: true }), logs: logs.filter((v) => v.outcome || v.type === "price_shown" || v.type === "show_session").slice(-20) });
    }

    // POST /bdev/leads/:id/status — the official status control
    // (Build -157). Distinct from the stage machine: the stage
    // still moves only by logging outcomes; this is the short
    // status list HQ rolls up.
    if (method === "POST" && seg[3] === "status") {
      const status = String(b.status || "");
      if (!STATUSES.includes(status)) return err(400, "Pick a status from the list.");
      // History is rep-facing: record the actor's NAME, never
      // the raw user id (a UUID rendered on the lead page in
      // the -161 rendered QA). Older entries already carrying
      // an id are hidden client-side.
      await setLeadStatus(lead, status, String(user.name || "").trim() || seat.repCode || "Rep");
      return json(200, { ok: true, lead: repLeadPayload(lead, { full: true }) });
    }

    if (method === "POST" && seg[3] === "checkin") {
      const open = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: effSeat.marketId, type: "visit", visitAt: nowIso(), createdAt: nowIso(), open: true, outcome: null };
      await store().set(`bdevlog:${open.id}`, open);
      return json(200, { logId: open.id, visitAt: open.visitAt });
    }

    if (method === "POST" && seg[3] === "log") {
      const outcome = String(b.outcome || "");
      if (!OUTCOMES.includes(outcome)) return err(400, "Pick what happened.");
      if (!b.spokeWith) return err(400, "Say who you talked to.");
      const logs = await allLogs(lead.id);
      // Offline retries carry a client uid — a log that already
      // landed is returned, never doubled.
      if (b.clientUid) {
        const dupe = logs.find((v) => v.clientUid === String(b.clientUid) && v.repId === seat.userId);
        if (dupe) return json(200, { ok: true, message: "Logged.", lead: repLeadPayload(lead, { full: true }), deduped: true });
      }
      let log = logs.find((v) => v.open && v.repId === seat.userId);
      if (!log) log = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: effSeat.marketId, type: "visit", visitAt: b.visitAt || nowIso(), createdAt: nowIso() };
      log.open = false;
      log.outcome = outcome;
      log.spokeWith = String(b.spokeWith);
      log.spokeName = b.spokeName ? String(b.spokeName).slice(0, 80) : null;
      log.interest = b.interest || null;
      log.objections = Array.isArray(b.objections) ? b.objections.filter((o) => OBJECTIONS.includes(o)) : [];
      log.catsWanted = Array.isArray(b.catsWanted) ? b.catsWanted.filter((c) => WANT_CATS.includes(c)) : [];
      log.supplyGap = b.supplyGap ? String(b.supplyGap).slice(0, 200) : null;
      log.competitor = COMPETITORS.includes(b.competitor) ? b.competitor : null;
      log.referral = b.referral ? String(b.referral).slice(0, 120) : null;
      log.saidWords = b.saidWords ? String(b.saidWords).slice(0, 1000) : null;
      log.walkInIntel = b.walkInIntel ? String(b.walkInIntel).slice(0, 1000) : null;
      log.visitType = ["In person", "Call", "Text", "Email", "Intro by someone"].includes(b.visitType) ? b.visitType : "In person";
      log.hasPhoto = !!b.hasPhoto;
      if (b.clientUid) log.clientUid = String(b.clientUid).slice(0, 60);
      if (b.photoData && typeof b.photoData === "string" && b.photoData.length < 900000) {
        await store().set(`bdevphoto:${lead.id}`, { dataBase64: b.photoData, contentType: String(b.photoType || "image/jpeg"), at: nowIso(), by: seat.userId });
        log.hasPhoto = true;
        lead.hasStorefrontPhoto = true;
      }
      log.syncedAt = nowIso();
      await store().set(`bdevlog:${log.id}`, log);

      // Stage machine — the rep never edits the stage by hand.
      const fromStage = lead.stage;
      const toStage = OUTCOME_STAGE[outcome];
      if (toStage && toStage !== fromStage) {
        lead.stage = toStage;
        lead.stageHistory = [...(lead.stageHistory || []), { stage: toStage, at: nowIso(), by: "Visit log" }];
      }
      lead.lastTouch = { at: log.visitAt, type: log.visitType, outcome };
      // Follow-up: explicit pick wins; otherwise the outcome default.
      let fuDate = null, fuWhat = "";
      if (b.followUp === "none") { fuDate = null; }
      else if (b.followUpDate) { fuDate = String(b.followUpDate).slice(0, 10); }
      else {
        const def = OUTCOME_DEFAULT_FOLLOWUP[outcome];
        if (def != null) fuDate = addDaysStr(todayStr(), def);
      }
      if (outcome === "Claimed a founding spot") {
        lead.founding = { ...(lead.founding || {}), status: lead.founding && lead.founding.status === "Confirmed" ? "Confirmed" : "Claimed", claimedAt: (lead.founding && lead.founding.claimedAt) || nowIso(), claimedVia: (lead.founding && lead.founding.claimedVia) || "In person (verbal)" };
        lead.nextAction = null;
        await logCapture({ type: "bdev_claim", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: effSeat.marketName, data: { via: "verbal", repCode: seat.repCode } });
        await logEvent({ type: "bdev_founding_claimed", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: effSeat.marketName, data: { business: lead.name, repCode: seat.repCode } });
      } else if (fuDate) {
        fuWhat = outcome === "Owner not in" ? "Try again — catch the owner" : outcome.startsWith("Very interested") ? "Follow up while it's warm" : "Follow up";
        lead.nextAction = { type: b.followUpType || "Visit", date: fuDate, what: fuWhat };
      } else {
        lead.nextAction = null;
      }
      if (b.notFitReason && NOT_FIT_REASONS.includes(b.notFitReason)) lead.notFitReason = b.notFitReason;
      if (!lead.attribution.firstTouchAt) lead.attribution.firstTouchAt = log.visitAt;
      // Never-contact-again: lock the lead + platform DNC, same sync.
      if (outcome === "Owner said never contact again") {
        lead.flags = { ...(lead.flags || {}), doNotContact: true };
        for (const k of leadMatchKeys(lead)) await addDnc({ key: k, kind: "lead", label: lead.name, source: "Rep log: owner said never contact again" });
        await logEvent({ type: "bdev_dnc_set_by_log", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: effSeat.marketName, data: { business: lead.name } });
      }
      if (log.referral) {
        const pendId = uuid();
        await store().set(`bdevpending:${pendId}`, { id: pendId, name: log.referral, fromLeadId: lead.id, fromRepId: seat.userId, marketId: effSeat.marketId, createdAt: nowIso(), status: "pending" });
      }
      await saveLead(lead);
      await logCapture({ type: "bdev_visit", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: effSeat.marketName, data: { outcome, objections: log.objections, catsWanted: log.catsWanted, supplyGap: log.supplyGap, competitor: log.competitor, spokeWith: log.spokeWith } });
      const confirm = outcome === "Claimed a founding spot" ? "Logged. Founding spot claimed — HQ confirms it." : fuDate ? `Logged. Follow-up set for ${fuDate}.` : "Logged.";
      return json(200, { ok: true, message: confirm, lead: repLeadPayload(lead, { full: true }) });
    }

    if (method === "POST" && seg[3] === "escalate") {
      const rec = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: effSeat.marketId, reason: String(b.reason || "Other").slice(0, 80), note: String(b.note || "").slice(0, 500), status: "open", createdAt: nowIso() };
      await store().set(`bdevesc:${rec.id}`, rec);
      await logEvent({ type: "bdev_escalation", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: effSeat.marketName, data: { business: lead.name, reason: rec.reason } });
      return json(200, { ok: true, holdingLine: kitFor(effSeat).holdingLine });
    }

    if (method === "POST" && seg[3] === "price-shown") {
      const rec = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: effSeat.marketId, type: "price_shown", visitAt: null, createdAt: nowIso(), outcome: null };
      await store().set(`bdevlog:${rec.id}`, rec);
      await logCapture({ type: "bdev_price_shown", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: effSeat.marketName, data: {} });
      return json(200, { ok: true });
    }

    if (method === "POST" && seg[3] === "show-session") {
      const rec = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: effSeat.marketId, type: "show_session", visitAt: null, createdAt: nowIso(), outcome: null, pages: Number(b.pages) || 0, seconds: Number(b.seconds) || 0 };
      await store().set(`bdevlog:${rec.id}`, rec);
      await logCapture({ type: "bdev_show_session", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: effSeat.marketName, data: { pages: rec.pages, seconds: rec.seconds } });
      return json(200, { ok: true });
    }

    if (method === "POST" && seg[3] === "send-claim") {
      lead.nextAction = { type: "Wait", date: addDaysStr(todayStr(), 2), what: "Said yes — claim link not finished" };
      await saveLead(lead);
      return json(200, { ok: true, claimUrl: `${process.env.APP_URL || ""}${claimPath(lead)}`, message: "Send them this link — it carries your code, so the claim comes back to you." });
    }

    if (method === "GET" && seg[3] === "show") {
      if (lead.flags && (lead.flags.doNotContact || lead.flags.jeffHandles)) return err(403, "This lead can't be shown.");
      const show = await showBench(effSeat.marketId, lead.category, { neighborhood: lead.neighborhood || "", city: lead.city || "" }, effSeat.marketName);
      const progress = await marketProgress(effSeat.marketId);
      void progress;
      return json(200, {
        lead: { id: lead.id, name: lead.name, category: lead.category },
        marketName: effSeat.marketName,
        bench: show.cards,
        areaFraming: show.areaFraming,
        claimUrl: claimPath(lead),
        repFirstName: String(user.name || "").split(" ")[0] || "",
      });
    }

    if (method === "GET" && seg[3] === "oneliner") {
      const logs = await allLogs(lead.id);
      const last = [...logs].reverse().find((v) => v.outcome);
      const parts = [];
      if (lead.dmName) parts.push(`${lead.dmName.split(" ")[0]} ${lead.dmRoleLabel ? `(${lead.dmRoleLabel.toLowerCase()}) ` : ""}runs it.`);
      if (lead.usuallyHere) parts.push(`Usually here ${lead.usuallyHere}.`);
      if (last && last.objections && last.objections.length) parts.push(`Last time they pushed back on: ${last.objections.join(", ").toLowerCase()}.`);
      else if (last) parts.push(`Last visit: ${last.outcome.toLowerCase()}.`);
      if (!parts.length) parts.push("First visit — no history yet. Ask who owns it and when they're usually in.");
      return json(200, { text: parts.join(" ") });
    }
  }

  // GET /bdev/kit — Build -157 adds the practice set (its answers
  // are the live kit's own words, joined at module load).
  if (method === "GET" && seg[1] === "kit" && seg.length === 2) { const k161 = kitFor(effSeat); return json(200, { kit: k161, practice: practiceFor157(k161), seat: seatSummary(effSeat) }); }

  // POST /bdev/maggie/coach — kit answers only, word for word.
  // Money/terms questions NEVER get a kit-text match: they route
  // to the holding line (ruling 4 + the do-not-say list).
  if (method === "POST" && seg[1] === "maggie" && seg[2] === "coach") {
    const q = String(b.q || "").toLowerCase();
    if (/discount|free month|cheaper|split|percent|commission|guarantee|promise|exclusive|refund|contract|sign.*today|waive/.test(q)) {
      return json(200, effSeat.hqSeat
        ? { answer: `That one is your call — your holding line, word for word: “${kitFor(effSeat).holdingLine}”`, title: "Your call" }
        : { answer: `That one is Jeff's call — use the holding line, word for word: “${KIT.holdingLine}”`, title: "Ask Jeff" });
    }
    const coachKit161 = kitFor(effSeat);
    const pool = [...coachKit161.objections.map((o) => ({ title: o.q, text: o.a })), ...coachKit161.priceAnswers.map((o) => ({ title: o.title, text: o.text }))];
    const words = q.split(/[^a-z0-9%$]+/).filter((w) => w.length > 2);
    let best = null, bestScore = 0;
    for (const item of pool) {
      const hay = (item.title + " " + item.text).toLowerCase();
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (best && bestScore >= 2) return json(200, { answer: best.text, title: best.title });
    return json(200, effSeat.hqSeat
      ? { answer: `That one isn't in your Seller Kit — don't guess at it out loud. Your holding line: “${kitFor(effSeat).holdingLine}”`, title: "Your call" }
      : { answer: `That one isn't in the Seller Kit — don't guess at it. Use the Ask Jeff line: “${KIT.holdingLine}”`, title: "Ask Jeff" });
  }

  // GET /bdev/money — the payload builder is shared with HQ's
  // read-only preview (moneyPayload157); behavior is unchanged.
  if (method === "GET" && seg[1] === "money" && seg.length === 2) {
    return json(200, await moneyPayload157(effSeat));
  }

  // POST /bdev/pin {pin} set · POST /bdev/pin/verify {pin}
  if (method === "POST" && seg[1] === "pin") {
    const pin = String(b.pin || "");
    if (!/^\d{4}$/.test(pin)) return err(400, "The PIN is 4 numbers.");
    if (seg[2] === "verify") {
      if (!seat.pinHash) return err(400, "No PIN set yet.");
      return json(200, { ok: pinHashOf(pin, seat.pinSalt) === seat.pinHash });
    }
    seat.pinSalt = crypto.randomBytes(8).toString("hex");
    seat.pinHash = pinHashOf(pin, seat.pinSalt);
    await store().set(`bdevrep:${seat.userId}`, seat);
    return json(200, { ok: true });
  }

  return err(404, "Route not found");
}

// ---------------- public founding claim ----------------

async function publicClaim(event) {
  const b = parseBody(event);
  const repCode = String(b.rep || "").slice(0, 40);
  const leadId = String(b.lead || "").slice(0, 80);
  const businessName = String(b.businessName || "").trim().slice(0, 120);
  const contactName = String(b.name || "").trim().slice(0, 80);
  const contact = String(b.contact || "").trim().slice(0, 120);
  if (!businessName || !contact || !b.yes) return err(400, "Add your business name, the best way to reach you, and tick the founding-list box.");
  // Resolve the rep from the code (the seat is the attribution).
  let seat = null;
  if (repCode) {
    const rows = await store().list("bdevrep:");
    seat = rows.map((r) => r.value).find((v) => v && v.active && v.repCode === repCode) || null;
  }
  let lead = leadId ? await getLead(leadId) : null;
  // Build -161: a multi-market seat's code resolves in ANY of its
  // markets (Jeff's code works in Hampton Roads and Nashville).
  if (lead && seat && !seatHasMarket(seat, lead.marketId)) lead = null;
  let matchedVia = lead ? "lead link" : null;
  if (!lead) {
    // No link (or a code-only claim): resolve the business by name,
    // then phone, then Instagram — inside the rep's market when a
    // code came with it, across every market when it didn't (the
    // verbal-yes hold below then does the crediting).
    const pool = seat
      ? (await Promise.all(seatMarkets(seat).map((m) => leadsOfMarket(m.marketId)))).flat()
      : (await store().list("bdevlead:")).map((r) => r.value).filter(Boolean);
    lead = pool.find((l) => normName(l.name) === normName(businessName))
      || pool.find((l) => digits(l.phone1) && digits(l.phone1) === digits(contact))
      || pool.find((l) => l.instagram && normIg(l.instagram) === normIg(contact)) || null;
    if (lead) matchedVia = "name/contact match";
  }
  // Verbal-yes hold (ruling 6): an unattributed claim still credits
  // the rep whose visit log on this business is inside 30 days.
  let holdRepId = null;
  if (lead && !seat) {
    const logs = await allLogs(lead.id);
    const recent = [...logs].reverse().find((v) => v.outcome && (Date.now() - Date.parse(v.visitAt || v.createdAt)) < 30 * 86400000);
    if (recent) holdRepId = recent.repId;
  }
  const claim = {
    id: uuid(), leadId: lead ? lead.id : null, businessName, contactName, contact,
    repCode: seat ? seat.repCode : (holdRepId ? "hold" : null),
    repId: seat ? seat.userId : holdRepId,
    marketId: lead ? lead.marketId : (seat ? seat.marketId : null),
    matchedVia: matchedVia || (holdRepId ? "verbal-yes hold (log match)" : null),
    planInterest: [199, 349, 699].includes(Number(b.plan)) ? Number(b.plan) : null,
    status: "waiting HQ confirm", createdAt: nowIso(),
  };
  await store().set(`bdevclaim:${claim.id}`, claim);
  if (lead) {
    lead.founding = { ...(lead.founding || {}), status: lead.founding && lead.founding.status === "Confirmed" ? "Confirmed" : "Claimed", claimedAt: nowIso(), claimedVia: matchedVia === "lead link" ? "Claim form (rep link)" : "Claim form (card/QR)", planInterest: claim.planInterest || (lead.founding && lead.founding.planInterest) || null };
    if (lead.stage !== STAGE_CLAIMED) {
      lead.stage = STAGE_CLAIMED;
      lead.stageHistory = [...(lead.stageHistory || []), { stage: STAGE_CLAIMED, at: nowIso(), by: "Founding claim form" }];
    }
    lead.nextAction = null;
    await saveLead(lead);
  }
  await logCapture({ type: "bdev_claim", actorId: claim.repId, actorRole: "bizdev", subjectId: lead ? lead.id : claim.id, market: seat ? seat.marketName : null, data: { via: "claim form", matchedVia: claim.matchedVia } });
  await logEvent({ type: "bdev_founding_claimed", actorId: claim.repId, actorRole: "bizdev", subjectId: lead ? lead.id : claim.id, market: seat ? seat.marketName : null, data: { business: businessName, via: "claim form" } });
  return json(200, { ok: true, message: "You're on the list. We'll be in touch as the founding roster fills — and you'll hear from us before we open." });
}

function claimPageHtml(query) {
  const rep = esc((query && query.rep) || "");
  const lead = esc((query && query.lead) || "");
  return htmlPage(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claim your founding spot — Magpie</title><meta name="robots" content="noindex">
<link rel="icon" href="/assets/icon.png">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif&display=swap" rel="stylesheet">
<style>
 body{margin:0;font-family:'Instrument Sans',system-ui,sans-serif;background:#fff;color:#0B0D0C}
 .wrap{max-width:560px;margin:0 auto;padding:28px 20px 48px}
 .logo{height:34px}
 h1{font-family:'Instrument Serif',serif;font-weight:400;font-size:34px;line-height:1.15;margin:22px 0 10px}
 p{font-size:16px;line-height:1.55;color:#333}
 label{display:block;font-size:13px;font-weight:600;margin:18px 0 6px}
 input[type=text],input[type=tel]{width:100%;box-sizing:border-box;padding:13px 14px;font-size:16px;border:1px solid #D8DCD9;border-radius:12px}
 .check{display:flex;gap:10px;align-items:flex-start;margin:22px 0;font-size:15px;line-height:1.45}
 .check input{width:20px;height:20px;margin-top:2px}
 button{width:100%;padding:15px;font-size:16px;font-weight:600;background:#0B0D0C;color:#fff;border:0;border-radius:999px;cursor:pointer}
 .fine{font-size:13px;color:#6B7268}
 .ok{background:#F2F7F3;border:1px solid #D8E5DA;border-radius:14px;padding:16px;font-size:16px;line-height:1.5}
 .err{background:#FBF1EC;border:1px solid #EDD5CB;border-radius:14px;padding:12px 16px;font-size:14px;display:none}
</style></head><body><div class="wrap">
<img class="logo" src="/assets/logo.png" alt="Magpie">
<h1>Claim your founding spot</h1>
<p data-mkt>Magpie is building the founding creator list for Hampton Roads right now. Shops that claim a founding spot are first in line when we open — first pick of creators, founding pricing locked, and we'll set your page up with you. There's nothing to pay today.</p>
<div class="err" id="err"></div>
<form id="f">
 <label for="biz">Business name</label><input type="text" id="biz" autocomplete="organization" required>
 <label for="nm">Your name</label><input type="text" id="nm" autocomplete="name">
 <label for="ct">Best phone or Instagram to reach you</label><input type="text" id="ct" required>
 <div class="check"><input type="checkbox" id="yes"><span data-mkt>Yes — put us on the Hampton Roads founding list.</span></div>
 <button type="submit">Claim your founding spot</button>
 <p class="fine">No payment today, and no date promised — we open when the founding creator roster is full, and founding shops hear first.</p>
</form>
<div class="ok" id="done" style="display:none">You're on the list. We'll be in touch as the founding roster fills — and you'll hear from us before we open.</div>
<script>
 const rep=${JSON.stringify((query && query.rep) || "")}, lead=${JSON.stringify((query && query.lead) || "")};
 if (lead) { fetch('/api/bdev/claim-info?lead=' + encodeURIComponent(lead)).then(r => r.json()).then(d => { if (d && d.businessName) document.getElementById('biz').value = d.businessName; if (d && d.marketName && d.marketName !== 'Hampton Roads') { document.querySelectorAll('[data-mkt]').forEach(function (el) { el.textContent = el.textContent.split('Hampton Roads').join(d.marketName); }); } }).catch(() => {}); }
 document.getElementById('f').addEventListener('submit', async (e) => {
   e.preventDefault();
   const err = document.getElementById('err'); err.style.display = 'none';
   const body = { rep, lead, businessName: document.getElementById('biz').value, name: document.getElementById('nm').value, contact: document.getElementById('ct').value, yes: document.getElementById('yes').checked };
   try {
     const r = await fetch('/api/bdev/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
     const d = await r.json();
     if (!r.ok) throw new Error(d.error || 'Something went wrong.');
     document.getElementById('f').style.display = 'none';
     document.getElementById('done').style.display = 'block';
   } catch (ex) { err.textContent = ex.message; err.style.display = 'block'; }
 });
</script></div></body></html>`);
}

// ---------------- HQ / Admin API ----------------

function adminLeadPayload(lead) {
  return {
    ...repLeadPayload(lead, { full: true }),
    marketId: lead.marketId, assignedRepId: lead.assignedRepId,
    hqTier: lead.hqTier, dmNameRaw: lead.dmName || null,
    status: statusOf(lead),
    statusHistory: lead.statusHistory || [],
    hqResearch: lead.hqResearch || null,
    hasPlaybook: !!lead.playbook,
    attribution: lead.attribution || null, hqDecision: lead.hqDecision || null,
    notFitReason: lead.notFitReason || null, updatedAt: lead.updatedAt,
  };
}

async function handleAdminBizdevApi({ user, seg, method, event }) {
  if (!user || user.role !== "admin") return err(403, "Admins only.");
  const b = method === "POST" ? parseBody(event) : {};
  const sub = seg[2];

  // Build -157 PREVIEW ("See Tony's view") — GET-only and strictly
  // read-only: no store.set, no logEvent, no logCapture anywhere
  // in these paths (the home builder runs with its Monday
  // scoreboard generation suppressed, and lead payloads are built
  // directly — the rep list route's isNewForRep clearing write is
  // never reused here).
  if (method === "GET" && sub === "preview" && seg.length === 3) {
    const qp = event.queryStringParameters || {};
    const seat = await previewSeat157(String(qp.repId || ""));
    if (!seat) return err(404, "That rep seat isn't active.");
    const targetUser = await userRecord157(seat.userId);
    const home = await buildRepHome157(seat, targetUser, { lazyScoreboard: false });
    const book = (await leadsOfMarket(seat.marketId)).filter((l) => l.assignedRepId === seat.userId);
    const bench = await benchCreators157(seat.marketId);
    return json(200, {
      preview: true,
      seat: { userId: seat.userId, repName: targetUser.name || "", repCode: seat.repCode, marketName: seat.marketName, marketId: seat.marketId },
      home,
      leads: book.map((l) => repLeadPayload(l)),
      kit: { kit: KIT, practice: PRACTICE157 },
      money: await moneyPayload157(seat),
      queue: buildQueue157(book, bench),
      trips: buildTrips157(book, bench),
    });
  }

  if (method === "GET" && sub === "preview" && seg.length === 4 && seg[3] === "lead") {
    const qp = event.queryStringParameters || {};
    const repId = String(qp.repId || "");
    const seat = await previewSeat157(repId);
    if (!seat) return err(404, "That rep seat isn't active.");
    const lead = await getLead(String(qp.lead || ""));
    if (!lead || lead.marketId !== seat.marketId || lead.assignedRepId !== repId) return err(404, "That lead isn't in this rep's book.");
    const targetUser = await userRecord157(seat.userId);
    const logs = await allLogs(lead.id);
    const show = await showBench(seat.marketId, lead.category, { neighborhood: lead.neighborhood || "", city: lead.city || "" }, seat.marketName);
    return json(200, {
      preview: true,
      lead: repLeadPayload(lead, { full: true }),
      logs: logs.filter((v) => v.outcome || v.type === "price_shown" || v.type === "show_session").slice(-20),
      show: {
        lead: { id: lead.id, name: lead.name, category: lead.category },
        marketName: seat.marketName,
        bench: show.cards,
        areaFraming: show.areaFraming,
        claimUrl: claimPath(lead),
        repFirstName: String(targetUser.name || "").split(" ")[0] || "",
      },
    });
  }

  if (method === "GET" && sub === "overview" && seg.length === 3) {
    const leads = await allLeads();
    const seats = (await store().list("bdevrep:")).map((r) => r.value).filter((v) => v && v.active);
    const users = deps.allUsers ? await deps.allUsers() : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const markets = {};
    for (const l of leads) {
      const m = markets[l.marketId] || (markets[l.marketId] = { marketId: l.marketId, marketName: l.marketName || l.marketId, loaded: 0, touched: 0, visited: 0, interested: 0, claimed: 0, confirmed: 0, ready: 0, active: 0 });
      m.loaded += 1;
      if (l.lastTouch) m.touched += 1;
      if (l.lastTouch && l.lastTouch.type === "In person") m.visited += 1;
      if (["Talked — needs to think", "Talked — wants a follow-up"].includes(l.stage)) m.interested += 1;
      if (l.stage === STAGE_CLAIMED) { m.claimed += 1; if (l.founding && l.founding.status === "Confirmed") m.confirmed += 1; }
    }
    for (const mid of Object.keys(markets)) {
      markets[mid].progress = await marketProgress(mid);
      markets[mid].state = await marketState(mid);
    }
    const claims = (await store().list("bdevclaim:")).map((r) => r.value).filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const escalations = (await store().list("bdevesc:")).map((r) => r.value).filter((v) => v && v.status === "open")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const pendingLeads = leads.filter((l) => l.pendingApproval);
    const pendingReferrals = (await store().list("bdevpending:")).map((r) => r.value).filter((v) => v && v.status === "pending");
    const acts = await allActivations();
    for (const mid of Object.keys(markets)) markets[mid].active = acts.filter((a) => a.marketId === mid).length;
    const liabilityCalc = await liability();
    // Disputes: unmatched claims + soft-duplicate holds + double-source.
    const disputes = claims.filter((c) => !c.leadId).map((c) => ({ kind: "unmatched-claim", id: c.id, businessName: c.businessName, contact: c.contact, createdAt: c.createdAt }));
    // Build -157: status rollup per market / city / neighborhood,
    // over every lead, read through the official status control.
    const emptyStatusCounts = () => Object.fromEntries(STATUSES.map((s) => [s, 0]));
    const statusRollup = {};
    for (const l of leads) {
      const m = statusRollup[l.marketId] || (statusRollup[l.marketId] = { marketId: l.marketId, byStatus: emptyStatusCounts(), _city: new Map(), _nb: new Map() });
      const st = statusOf(l);
      m.byStatus[st] += 1;
      const city = l.city || "";
      if (!m._city.has(city)) m._city.set(city, emptyStatusCounts());
      m._city.get(city)[st] += 1;
      const nb = l.neighborhood || "";
      const nbKey = `${nb}||${city}`;
      if (!m._nb.has(nbKey)) m._nb.set(nbKey, { neighborhood: nb, city, counts: emptyStatusCounts() });
      m._nb.get(nbKey).counts[st] += 1;
    }
    for (const m of Object.values(statusRollup)) {
      m.byCity = [...m._city.entries()].map(([city, counts]) => ({ city, counts })).sort((a, b) => a.city.localeCompare(b.city));
      m.byNeighborhood = [...m._nb.values()].sort((a, b) => a.neighborhood.localeCompare(b.neighborhood) || a.city.localeCompare(b.city));
      delete m._city; delete m._nb;
    }
    const prewarm = (await store().list("bdevprewarm:")).map((r) => r.value).filter(Boolean)
      .map((r) => ({ leadId: r.leadId, business: r.business, toName: r.toName, draft: r.draft }))
      .sort((a, b) => String(a.business).localeCompare(String(b.business)));
    const latestByRep = (rows) => {
      const map = new Map();
      for (const r of rows) {
        const cur = map.get(r.repId);
        if (!cur || String(r.createdAt || r.date || "") > String(cur.createdAt || cur.date || "")) map.set(r.repId, r);
      }
      return [...map.values()];
    };
    const scoreboards = latestByRep((await store().list("bdevscore:")).map((r) => r.value).filter(Boolean))
      .map((r) => ({ repId: r.repId, weekOf: r.weekOf, lines: r.lines, stats: r.stats, createdAt: r.createdAt }))
      .sort((a, b) => String(a.repId).localeCompare(String(b.repId)));
    const alarmSummary = latestByRep((await store().list("bdevalarm:")).map((r) => r.value).filter(Boolean))
      .map((r) => ({ repId: r.repId, date: r.date, count: Array.isArray(r.items) ? r.items.length : 0 }))
      .sort((a, b) => String(a.repId).localeCompare(String(b.repId)));
    return json(200, {
      markets: Object.values(markets),
      statusRollup, prewarm, scoreboards, alarmSummary,
      reps: seats.map((s) => { const u = byId.get(s.userId); return { userId: s.userId, name: u ? u.name : "", email: u ? u.email : "", marketId: s.marketId, marketName: s.marketName, repCode: s.repCode, seatState: s.seatState, vestedAt: s.vestedAt || null, warningMonth: s.warningMonth || null, atRisk: s.atRisk || null, hqSeat: !!s.hqSeat, markets: seatMarkets(s) }; }),
      unconfirmedClaims: claims.filter((c) => c.status === "waiting HQ confirm"),
      escalations, pendingLeads: pendingLeads.map(adminLeadPayload), pendingReferrals,
      disputes, liability: liabilityCalc,
      dnc: await dncRecords(),
    });
  }

  if (method === "GET" && sub === "leads" && seg.length === 3) {
    const qp = event.queryStringParameters || {};
    const marketId = qp.market || null;
    let leads = await allLeads();
    if (marketId) leads = leads.filter((l) => l.marketId === marketId);
    // Build -157: facets come from the set BEFORE the new
    // city/neighborhood/status filters apply (the market filter
    // above still scopes them, as it always has).
    const cities = [...new Set(leads.map((l) => l.city || "").filter(Boolean))].sort();
    const nbSeen = new Map();
    for (const l of leads) {
      const name = l.neighborhood || "";
      if (!name) continue;
      const k = `${name}||${l.city || ""}`;
      if (!nbSeen.has(k)) nbSeen.set(k, { name, city: l.city || "" });
    }
    const facets = { cities, neighborhoods: [...nbSeen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.city.localeCompare(b.city)) };
    if (qp.city) leads = leads.filter((l) => (l.city || "") === qp.city);
    if (qp.neighborhood) leads = leads.filter((l) => (l.neighborhood || "") === qp.neighborhood);
    if (qp.status) leads = leads.filter((l) => statusOf(l) === qp.status);
    leads.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return json(200, { leads: leads.map(adminLeadPayload), facets });
  }

  if (method === "POST" && sub === "reps" && seg[3] === "assign") {
    const email = normEmail(b.email || "");
    const idx = await store().get(`email:${email}`);
    if (!idx || !idx.userId) return err(404, "No account with that email.");
    const target = await store().get(`user:${idx.userId}`);
    if (!target) return err(404, "Account not found.");
    const marketId = String(b.marketId || "hampton-roads");
    const marketName = String(b.marketName || "Hampton Roads");
    const repCode = String(b.repCode || "").trim();
    if (!repCode) return err(400, "A rep code is required.");
    const seat = await assignSeat({ userId: target.id, marketId, marketName, repCode, seatState: b.seatState || "probation" });
    await stampUserSeat(target, seat);
    await logEvent({ type: "bdev_seat_assigned", actorId: user.id, actorRole: "admin", subjectId: target.id, market: marketName, data: { repCode } });
    return json(200, { ok: true, seat: { userId: target.id, repCode, marketId } });
  }

  if (method === "POST" && sub === "markets" && seg[3] === "state") {
    const state = String(b.state || "");
    if (!["Building", "Ready", "Open"].includes(state)) return err(400, "Market state must be Building, Ready, or Open.");
    await setMarketState(String(b.marketId || ""), state);
    await logEvent({ type: "bdev_market_state", actorId: user.id, actorRole: "admin", subjectId: null, market: b.marketId || null, data: { state } });
    return json(200, { ok: true });
  }

  if (method === "POST" && sub === "leads" && seg.length >= 4) {
    const lead = await getLead(seg[3]);
    if (!lead) return err(404, "Lead not found.");
    const action = seg[4];
    if (action === "status") {
      const status = String(b.status || "");
      if (!STATUSES.includes(status)) return err(400, "Pick a status from the list.");
      await setLeadStatus(lead, status, "Jeff (HQ)");
      return json(200, { ok: true });
    }
    if (action === "approve") {
      lead.pendingApproval = false; lead.hqDecision = { decision: "approved", at: nowIso(), by: user.id };
      await saveLead(lead);
      return json(200, { ok: true });
    }
    if (action === "reject") {
      lead.pendingApproval = false;
      lead.hqDecision = { decision: "rejected", line: String(b.line || "Not approved — talk to Jeff.").slice(0, 200), at: nowIso(), by: user.id };
      await saveLead(lead);
      return json(200, { ok: true });
    }
    if (action === "confirm-claim") {
      lead.founding = { ...(lead.founding || {}), status: "Confirmed", confirmedAt: nowIso(), confirmedBy: user.id };
      await saveLead(lead);
      const claimRows = (await store().list("bdevclaim:")).map((r) => r.value).filter((c) => c && c.leadId === lead.id && c.status === "waiting HQ confirm");
      for (const c of claimRows) { c.status = "confirmed"; await store().set(`bdevclaim:${c.id}`, c); }
      await logEvent({ type: "bdev_claim_confirmed", actorId: user.id, actorRole: "admin", subjectId: lead.id, market: lead.marketName || lead.marketId, data: { business: lead.name, note: "HQ sends the business its confirmation via the business lane (outside the app)." } });
      return json(200, { ok: true });
    }
    if (action === "flags") {
      lead.flags = { ...(lead.flags || {}) };
      if (typeof b.doNotContact === "boolean") {
        lead.flags.doNotContact = b.doNotContact;
        if (b.doNotContact) for (const k of leadMatchKeys(lead)) await addDnc({ key: k, kind: "lead", label: lead.name, source: "HQ flag" });
      }
      if (typeof b.jeffHandles === "boolean") lead.flags.jeffHandles = b.jeffHandles;
      if (typeof b.chain === "boolean") lead.flags.chain = b.chain;
      await saveLead(lead);
      return json(200, { ok: true });
    }
    if (action === "reassign") {
      const targetSeat = await store().get(`bdevrep:${String(b.repId || "")}`);
      if (!targetSeat || !targetSeat.active) return err(404, "That rep seat isn't active.");
      lead.assignedRepId = targetSeat.userId;
      lead.isNewForRep = true;
      if (lead.attribution) lead.attribution.repCode = targetSeat.repCode;
      await saveLead(lead);
      return json(200, { ok: true });
    }
    if (action === "activate") {
      const state = await marketState(lead.marketId);
      if (state !== "Open") return err(409, "This market isn't open for payments — activation stays dormant until Jeff opens it.");
      const plan = [199, 349, 699].includes(Number(b.plan)) ? Number(b.plan) : null;
      const act = {
        id: uuid(), repId: lead.assignedRepId, marketId: lead.marketId, leadId: lead.id,
        businessName: lead.name, direct: true, plan,
        championName: lead.attribution && lead.attribution.championName ? lead.attribution.championName : null,
        activatedAt: nowIso(), windowStart: monthOf(nowIso()), months: [],
      };
      await store().set(`bdevact:${act.id}`, act);
      lead.founding = { ...(lead.founding || {}), status: "Confirmed" };
      lead.activatedAt = act.activatedAt;
      await saveLead(lead);
      await logEvent({ type: "bdev_activation_confirmed", actorId: user.id, actorRole: "admin", subjectId: lead.id, market: lead.marketName || lead.marketId, data: { business: lead.name, plan } });
      return json(200, { ok: true, activation: act });
    }
    return err(404, "Action not found.");
  }

  if (method === "POST" && sub === "claims" && seg[3] && seg[4] === "match") {
    const claim = await store().get(`bdevclaim:${seg[3]}`);
    if (!claim) return err(404, "Claim not found.");
    const lead = await getLead(String(b.leadId || ""));
    if (!lead) return err(404, "Lead not found.");
    claim.leadId = lead.id; claim.repId = lead.assignedRepId; claim.repCode = lead.attribution ? lead.attribution.repCode : claim.repCode;
    claim.matchedVia = "HQ match (disputes queue)";
    await store().set(`bdevclaim:${claim.id}`, claim);
    lead.founding = { ...(lead.founding || {}), status: "Claimed", claimedAt: claim.createdAt, claimedVia: "Claim form (card/QR)" };
    lead.stage = STAGE_CLAIMED;
    await saveLead(lead);
    return json(200, { ok: true });
  }

  if (method === "POST" && sub === "escalations" && seg[3] && seg[4] === "close") {
    const rec = await store().get(`bdevesc:${seg[3]}`);
    if (!rec) return err(404, "Escalation not found.");
    rec.status = "closed"; rec.closedAt = nowIso();
    await store().set(`bdevesc:${rec.id}`, rec);
    return json(200, { ok: true });
  }

  if (method === "POST" && sub === "dnc" && seg.length === 3) {
    if (b.removeKey) { await store().del(`bdevdnc:${String(b.removeKey)}`); return json(200, { ok: true }); }
    const label = String(b.label || "").trim();
    if (!label) return err(400, "Name the business.");
    await addDnc({ key: "nm:" + normName(label), kind: "manual", label, source: "HQ manual entry" });
    // Lock any matching lead immediately (outreach -> dashboard direction).
    for (const lead of await allLeads()) {
      if (normName(lead.name) === normName(label) && !lead.flags.doNotContact) {
        lead.flags = { ...(lead.flags || {}), doNotContact: true };
        await saveLead(lead);
      }
    }
    return json(200, { ok: true });
  }

  return err(404, "Route not found");
}

module.exports = {
  init, handleBizdevApi, handleAdminBizdevApi, maybeSeedBizdev, maybeEnrich157, maybeLoadDest20261109, maybeLoadJeffSeat161, runBizdevSweep,
  claimPageHtml, seatOf, KIT,
  _test: { rateForMonth, vestingOf, keptBookAt, normName, digits, reachLine, OUTCOME_STAGE, STATUSES, statusOf, weekWindow, queueCandidates, creatorsToShow, seatMarkets, seatHasMarket, effectiveSeat, kitFor, jeffKit161, practiceFor157 },
};
