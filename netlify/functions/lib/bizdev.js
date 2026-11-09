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
  let total = 0; const perRep = [];
  for (const repId of reps) {
    const marketId = (acts.find((a) => a.repId === repId) || {}).marketId;
    const m = await moneyFor(repId, marketId);
    total += m.accrued;
    perRep.push({ repId, marketId, accrued: m.accrued, activations: m.activations, vested: m.vesting.vested });
  }
  return { totalAccrued: Math.round(total * 100) / 100, perRep, activations: acts.length };
}

// ---------------- Seller Kit (verbatim, spec §6) ----------------

const KIT = {
  version: "2026-11-08",
  deck: { label: "Seller deck", version: "v4 — Nov 8", url: "/assets/bizdev-deck-v4.pdf" },
  openers: [
    { title: "30-second opener", text: "Hey, I'm Tony — I'm local, I'm with Magpie. We're putting together the founding list of Hampton Roads creators — people whose followers actually live here — and when we open, local shops will use them to get neighbors in the door. Shops in your kind of business are claiming founding spots now, before we open. Can I show you the creators for two minutes? That's it." },
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

async function showBench(marketId, leadCategory, leadArea) {
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
    categoryLine: c.community ? `A Hampton Roads ${String((c.categories || [])[0] || "local").toLowerCase()} community` : ((c.categories || [])[0] || "Local creator"),
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

  // GET /bdev/home
  if (method === "GET" && seg[1] === "home" && seg.length === 2) {
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
    return json(200, {
      rep: { firstName: String(user.name || "").split(" ")[0] || "Rep", marketName: seat.marketName, repCode: seat.repCode, seatState: seat.seatState, pinSet: !!seat.pinHash },
      date: today, brief,
      plan: { zoneLabel: plan.zoneLabel, stops: plan.stops, doneCount: plan.doneCount, totalCount: plan.totalCount, clusters: plan.clusters },
      followUps, newLeads, progress,
      numbers: { claimedThisMonth: leads.filter((l) => l.founding && l.founding.claimedAt && monthOf(l.founding.claimedAt) === monthOf(nowIso())).length, visitsThisWeek, moneyBuilding: money.accrued },
      unfinished,
    });
  }

  // GET /bdev/leads?q=&filter=
  if (method === "GET" && seg[1] === "leads" && seg.length === 2) {
    let leads = (await leadsOfMarket(seat.marketId)).filter((l) => l.assignedRepId === seat.userId);
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
    return json(200, { leads: leads.map((l) => repLeadPayload(l)) });
  }

  // POST /bdev/leads — rep adds a lead (work now, counts after Jeff approves)
  if (method === "POST" && seg[1] === "leads" && seg.length === 2) {
    const name = String(b.name || "").trim();
    if (!name) return err(400, "The business needs a name.");
    if (!CATEGORIES.includes(b.category)) return err(400, "Pick the business kind from the list.");
    const candidate = {
      marketId: seat.marketId, name, neighborhood: String(b.neighborhood || "").trim(),
      phone1: b.phone || null, instagram: b.instagram || null, email: b.email || null,
    };
    const marketLeads = await leadsOfMarket(seat.marketId);
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
      id: uuid(), marketId: seat.marketId, marketName: seat.marketName, locationId: uuid(), masterId: null,
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
    await logCapture({ type: "bdev_lead_added", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: seat.marketName, data: { source: "Added by rep" } });
    return json(200, { lead: repLeadPayload(lead, { full: true }) });
  }

  // Lead-scoped routes
  if (seg[1] === "leads" && seg.length >= 3) {
    const lead = await getLead(seg[2]);
    if (!lead || lead.marketId !== seat.marketId) return err(404, "Not in your market — ask HQ.");
    if (lead.assignedRepId !== seat.userId) return err(404, "That lead isn't in your book.");

    if (method === "GET" && seg.length === 3) {
      const logs = await allLogs(lead.id);
      return json(200, { lead: repLeadPayload(lead, { full: true }), logs: logs.filter((v) => v.outcome || v.type === "price_shown" || v.type === "show_session").slice(-20) });
    }

    if (method === "POST" && seg[3] === "checkin") {
      const open = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: seat.marketId, type: "visit", visitAt: nowIso(), createdAt: nowIso(), open: true, outcome: null };
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
      if (!log) log = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: seat.marketId, type: "visit", visitAt: b.visitAt || nowIso(), createdAt: nowIso() };
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
        await logCapture({ type: "bdev_claim", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: seat.marketName, data: { via: "verbal", repCode: seat.repCode } });
        await logEvent({ type: "bdev_founding_claimed", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: seat.marketName, data: { business: lead.name, repCode: seat.repCode } });
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
        await logEvent({ type: "bdev_dnc_set_by_log", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: seat.marketName, data: { business: lead.name } });
      }
      if (log.referral) {
        const pendId = uuid();
        await store().set(`bdevpending:${pendId}`, { id: pendId, name: log.referral, fromLeadId: lead.id, fromRepId: seat.userId, marketId: seat.marketId, createdAt: nowIso(), status: "pending" });
      }
      await saveLead(lead);
      await logCapture({ type: "bdev_visit", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: seat.marketName, data: { outcome, objections: log.objections, catsWanted: log.catsWanted, supplyGap: log.supplyGap, competitor: log.competitor, spokeWith: log.spokeWith } });
      const confirm = outcome === "Claimed a founding spot" ? "Logged. Founding spot claimed — HQ confirms it." : fuDate ? `Logged. Follow-up set for ${fuDate}.` : "Logged.";
      return json(200, { ok: true, message: confirm, lead: repLeadPayload(lead, { full: true }) });
    }

    if (method === "POST" && seg[3] === "escalate") {
      const rec = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: seat.marketId, reason: String(b.reason || "Other").slice(0, 80), note: String(b.note || "").slice(0, 500), status: "open", createdAt: nowIso() };
      await store().set(`bdevesc:${rec.id}`, rec);
      await logEvent({ type: "bdev_escalation", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: seat.marketName, data: { business: lead.name, reason: rec.reason } });
      return json(200, { ok: true, holdingLine: KIT.holdingLine });
    }

    if (method === "POST" && seg[3] === "price-shown") {
      const rec = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: seat.marketId, type: "price_shown", visitAt: null, createdAt: nowIso(), outcome: null };
      await store().set(`bdevlog:${rec.id}`, rec);
      await logCapture({ type: "bdev_price_shown", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: seat.marketName, data: {} });
      return json(200, { ok: true });
    }

    if (method === "POST" && seg[3] === "show-session") {
      const rec = { id: uuid(), leadId: lead.id, repId: seat.userId, marketId: seat.marketId, type: "show_session", visitAt: null, createdAt: nowIso(), outcome: null, pages: Number(b.pages) || 0, seconds: Number(b.seconds) || 0 };
      await store().set(`bdevlog:${rec.id}`, rec);
      await logCapture({ type: "bdev_show_session", actorId: user.id, actorRole: "bizdev", subjectId: lead.id, market: seat.marketName, data: { pages: rec.pages, seconds: rec.seconds } });
      return json(200, { ok: true });
    }

    if (method === "POST" && seg[3] === "send-claim") {
      lead.nextAction = { type: "Wait", date: addDaysStr(todayStr(), 2), what: "Said yes — claim link not finished" };
      await saveLead(lead);
      return json(200, { ok: true, claimUrl: `${process.env.APP_URL || ""}${claimPath(lead)}`, message: "Send them this link — it carries your code, so the claim comes back to you." });
    }

    if (method === "GET" && seg[3] === "show") {
      if (lead.flags && (lead.flags.doNotContact || lead.flags.jeffHandles)) return err(403, "This lead can't be shown.");
      const show = await showBench(seat.marketId, lead.category, { neighborhood: lead.neighborhood || "", city: lead.city || "" });
      const progress = await marketProgress(seat.marketId);
      void progress;
      return json(200, {
        lead: { id: lead.id, name: lead.name, category: lead.category },
        marketName: seat.marketName,
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

  // GET /bdev/kit
  if (method === "GET" && seg[1] === "kit" && seg.length === 2) return json(200, { kit: KIT });

  // POST /bdev/maggie/coach — kit answers only, word for word.
  // Money/terms questions NEVER get a kit-text match: they route
  // to the holding line (ruling 4 + the do-not-say list).
  if (method === "POST" && seg[1] === "maggie" && seg[2] === "coach") {
    const q = String(b.q || "").toLowerCase();
    if (/discount|free month|cheaper|split|percent|commission|guarantee|promise|exclusive|refund|contract|sign.*today|waive/.test(q)) {
      return json(200, { answer: `That one is Jeff's call — use the holding line, word for word: “${KIT.holdingLine}”`, title: "Ask Jeff" });
    }
    const pool = [...KIT.objections.map((o) => ({ title: o.q, text: o.a })), ...KIT.priceAnswers.map((o) => ({ title: o.title, text: o.text }))];
    const words = q.split(/[^a-z0-9%$]+/).filter((w) => w.length > 2);
    let best = null, bestScore = 0;
    for (const item of pool) {
      const hay = (item.title + " " + item.text).toLowerCase();
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (best && bestScore >= 2) return json(200, { answer: best.text, title: best.title });
    return json(200, { answer: `That one isn't in the Seller Kit — don't guess at it. Use the Ask Jeff line: “${KIT.holdingLine}”`, title: "Ask Jeff" });
  }

  // GET /bdev/money
  if (method === "GET" && seg[1] === "money" && seg.length === 2) {
    const money = await moneyFor(seat.userId, seat.marketId);
    const leads = (await leadsOfMarket(seat.marketId)).filter((l) => l.assignedRepId === seat.userId);
    const pipeline = leads.filter((l) => (l.founding && (l.founding.status === "Claimed" || l.founding.status === "Confirmed")) || (l.stage || "").startsWith("Very interested"))
      .map((l) => ({ name: l.name, status: l.founding && l.founding.status !== "Not claimed" ? l.founding.status : "Interested", plan: (l.founding && l.founding.planInterest) || null, claimedAt: (l.founding && l.founding.claimedAt) || null }));
    const pipelineValue = pipeline.reduce((n, p) => n + (p.plan || BLENDED_MONTHLY) * 0.25, 0);
    const nextTier = money.rateNow.kept < 25
      ? { at: 25, rate: 30, have: money.rateNow.kept }
      : money.rateNow.kept < 75 ? { at: 75, rate: 35, have: money.rateNow.kept } : null;
    return json(200, {
      money: {
        accrued: money.accrued, ratePct: Math.round(money.rateNow.rate * 100), kept: money.rateNow.kept,
        shrank: money.rateNow.shrank, kicked: money.rateNow.kicked,
        newThisMonth: newActivationsIn((await activationsOf(seat.userId, seat.marketId)).filter((a) => a.direct), monthOf(nowIso())).length,
        vesting: money.vesting, perBusiness: money.perBusiness, residualCount: money.residualCount,
      },
      pipeline, pipelineMonthlyIfActive: Math.round(pipelineValue * 100) / 100,
      nextTier, seatState: seat.seatState, warningMonth: seat.warningMonth || null, atRisk: seat.atRisk || null,
    });
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
  if (lead && seat && lead.marketId !== seat.marketId) lead = null;
  let matchedVia = lead ? "lead link" : null;
  if (!lead) {
    // No link (or a code-only claim): resolve the business by name,
    // then phone, then Instagram — inside the rep's market when a
    // code came with it, across every market when it didn't (the
    // verbal-yes hold below then does the crediting).
    const pool = seat ? await leadsOfMarket(seat.marketId) : (await store().list("bdevlead:")).map((r) => r.value).filter(Boolean);
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
    marketId: seat ? seat.marketId : (lead ? lead.marketId : null),
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
<p>Magpie is building the founding creator list for Hampton Roads right now. Shops that claim a founding spot are first in line when we open — first pick of creators, founding pricing locked, and we'll set your page up with you. There's nothing to pay today.</p>
<div class="err" id="err"></div>
<form id="f">
 <label for="biz">Business name</label><input type="text" id="biz" autocomplete="organization" required>
 <label for="nm">Your name</label><input type="text" id="nm" autocomplete="name">
 <label for="ct">Best phone or Instagram to reach you</label><input type="text" id="ct" required>
 <div class="check"><input type="checkbox" id="yes"><span>Yes — put us on the Hampton Roads founding list.</span></div>
 <button type="submit">Claim your founding spot</button>
 <p class="fine">No payment today, and no date promised — we open when the founding creator roster is full, and founding shops hear first.</p>
</form>
<div class="ok" id="done" style="display:none">You're on the list. We'll be in touch as the founding roster fills — and you'll hear from us before we open.</div>
<script>
 const rep=${JSON.stringify((query && query.rep) || "")}, lead=${JSON.stringify((query && query.lead) || "")};
 if (lead) { fetch('/api/bdev/claim-info?lead=' + encodeURIComponent(lead)).then(r => r.json()).then(d => { if (d && d.businessName) document.getElementById('biz').value = d.businessName; }).catch(() => {}); }
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
    attribution: lead.attribution || null, hqDecision: lead.hqDecision || null,
    notFitReason: lead.notFitReason || null, updatedAt: lead.updatedAt,
  };
}

async function handleAdminBizdevApi({ user, seg, method, event }) {
  if (!user || user.role !== "admin") return err(403, "Admins only.");
  const b = method === "POST" ? parseBody(event) : {};
  const sub = seg[2];

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
    return json(200, {
      markets: Object.values(markets),
      reps: seats.map((s) => { const u = byId.get(s.userId); return { userId: s.userId, name: u ? u.name : "", email: u ? u.email : "", marketId: s.marketId, marketName: s.marketName, repCode: s.repCode, seatState: s.seatState, vestedAt: s.vestedAt || null, warningMonth: s.warningMonth || null, atRisk: s.atRisk || null }; }),
      unconfirmedClaims: claims.filter((c) => c.status === "waiting HQ confirm"),
      escalations, pendingLeads: pendingLeads.map(adminLeadPayload), pendingReferrals,
      disputes, liability: liabilityCalc,
      dnc: await dncRecords(),
    });
  }

  if (method === "GET" && sub === "leads" && seg.length === 3) {
    const marketId = (event.queryStringParameters || {}).market || null;
    let leads = await allLeads();
    if (marketId) leads = leads.filter((l) => l.marketId === marketId);
    leads.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return json(200, { leads: leads.map(adminLeadPayload) });
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
  init, handleBizdevApi, handleAdminBizdevApi, maybeSeedBizdev,
  claimPageHtml, seatOf, KIT,
  _test: { rateForMonth, vestingOf, keptBookAt, normName, digits, reachLine, OUTCOME_STAGE },
};
