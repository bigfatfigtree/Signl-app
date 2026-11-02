// Impact Portal: pilot funding partners (Build -77, Jeff,
// 2026-11-02). A pilot partner is NOT a media partner and NOT a
// recruiter: a local funder (a credit union, a Main Street group)
// puts up a fund that pays for FIRST creator visits at businesses
// it chooses in one city, ahead of SIGNL's launch there. The
// partner gets its own login, the Impact Portal, and sees exactly
// where its money went and what came back: which businesses were
// chosen, what each first visit cost, which posts went live, and
// how many customers the visits brought in.
//
// This is deliberately separate from the media-partner deal
// console (partner deals, revenue share) in name, role, and data:
// role "pilot_partner", records under pilot:/pilotbiz:/pilotspend:,
// API under /pilot (partner, read-only) and /admin/pilots (Admin).
// Nothing here is read by creator, business, recruiter, or
// Command Center surfaces, and nothing here writes to their
// records. The partner's numbers come from the pilot's own ledger
// plus the linked businesses' real bookings, posts, and customer
// counts (register-counted and business-recorded, always shown
// separately, never added together). Nothing is invented: a
// business with no linked records shows its status and nothing
// else.
//
// Records:
//   pilot:{id}          { id, name, partnerName, marketId,
//                         marketName, fundCents (committed),
//                         status: "active" | "closed",
//                         partnerUserId, createdBy, createdAt,
//                         updatedAt }
//   pilotbiz:{pilotId}:{id}
//                       one chosen business: { id, pilotId,
//                         businessId (a real business user id, or
//                         null for a name-only entry), name,
//                         marketName, status (the stored step:
//                         selected | invited | continued |
//                         declined | completed), createdBy,
//                         createdAt, updatedAt }
//   pilotspend:{pilotId}:{id}
//                       one ledger entry: { id, pilotId,
//                         pilotBizId, businessId, amountCents,
//                         bookingId (set on booking entries),
//                         kind: "booking" | "manual", note,
//                         date, createdBy, createdAt }
//   user.pilotId        stamped on the partner's login, the FK
//                         that scopes every partner read.
//
// Fund law: spent = the sum of the pilot's ledger entries,
// remaining = committed - spent. The first pilot-linked PAID
// booking for a chosen business writes its own ledger entry
// (kind "booking", the creator's listed rate that was booked),
// exactly once per booking, when the booking exists and has not
// expired. Admin can add manual entries (a visit arranged outside
// the booking flow) and remove manual entries; booking entries
// are the booking's own record and cannot be removed here.
//
// Status law: the stored step is Admin's word (selected, invited,
// continued, declined, completed). On top of it, the linked
// business's real records advance the step on read: a booking
// exists -> visit_booked; a visit finished -> visited; a post is
// live for it -> posted. Declined and completed are final and
// never derived over. "Continued" (the business joined SIGNL on a
// plan of its own) is derived only from a live plan state (an
// active business, or a subscription in an active state): a
// founding plan picked at sign-up but not yet active does not
// flip it on its own; Admin can also set it directly.

const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { logEvent } = require("./events");
const { MARKETS, normalizeMarketName } = require("./markets");

const PILOT_STATUSES = ["active", "closed"];
const STORED_STEPS = ["selected", "invited", "continued", "declined", "completed"];
const STEP_LABELS = {
  selected: "Chosen, not invited yet",
  invited: "Invited",
  visit_booked: "Visit booked",
  visited: "Visit done",
  posted: "Post live",
  continued: "Joined SIGNL",
  declined: "Said no",
  completed: "Finished",
};

let deps = {
  issuePasswordResetToken: null,
  passwordResetEmail: null,
  deliverEmail: null,
  allUsers: null,
  testMode: false,
};
function init(d) { deps = Object.assign({}, deps, d || {}); }
function testModeOn() { return typeof deps.testMode === "function" ? !!deps.testMode() : !!deps.testMode; }

function json(statusCode, obj, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, extraHeaders || {}),
    body: JSON.stringify(obj),
  };
}
function err(statusCode, message) { return json(statusCode, { error: message }); }
function parseBody(event) {
  if (!event.body) return {};
  let raw = event.body;
  if (event.isBase64Encoded) raw = Buffer.from(raw, "base64").toString("utf8");
  try { return JSON.parse(raw); } catch (e) { return {}; }
}
function nowIso() { return new Date().toISOString(); }
function isEmail(s) { return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function dollarsToCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function marketByNameLoose(name) {
  const n = normalizeMarketName(name || "");
  return MARKETS.find((m) => m.name === n) || MARKETS.find((m) => m.id === String(name || "").toLowerCase()) || null;
}

// ---------------- records ----------------

async function allPilots() {
  const rows = await store.list("pilot:");
  return rows.map((r) => r.value).filter(Boolean);
}
async function pilotById(id) {
  if (!id) return null;
  return store.get(`pilot:${id}`);
}
async function allPilotBiz(pilotId) {
  const rows = await store.list(`pilotbiz:${pilotId}:`);
  return rows.map((r) => r.value).filter(Boolean);
}
async function allPilotSpend(pilotId) {
  const rows = await store.list(`pilotspend:${pilotId}:`);
  return rows.map((r) => r.value).filter(Boolean);
}
async function allBookings() {
  const rows = await store.list("booking:");
  return rows.map((r) => r.value).filter(Boolean);
}
async function allPosts() {
  const rows = await store.list("post:");
  return rows.map((r) => r.value).filter(Boolean);
}
async function allRedemptionEvents() {
  const rows = await store.list("redevent:");
  return rows.map((r) => r.value).filter(Boolean);
}

// One data load for every pilot computation, so the overview,
// the business list, the results, and the printed report can
// never disagree with each other.
async function pilotContext(pilot) {
  const [biz, spends, bookings, posts, events, users] = await Promise.all([
    allPilotBiz(pilot.id),
    allPilotSpend(pilot.id),
    allBookings(),
    allPosts(),
    allRedemptionEvents(),
    deps.allUsers ? deps.allUsers() : [],
  ]);
  const usersById = new Map(users.map((u) => [u.id, u]));
  return { pilot, biz, spends, bookings, posts, events, usersById };
}

// The bookings that belong to this pilot for one chosen
// business: the business's own bookings made after the business
// was chosen. Anything booked before the pilot picked them is
// not the pilot's visit.
function linkedBookings(pb, bookings) {
  if (!pb.businessId) return [];
  const since = Date.parse(pb.createdAt) || 0;
  return bookings
    .filter((b) => b && b.businessId === pb.businessId && (Date.parse(b.createdAt) || 0) >= since)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// Per-booking customer counts, split the way every SIGNL results
// surface splits them (the same rule as the router's
// bookingMoneyFrom): register events win when they exist (those
// customers are COUNTED), the business's own reported tally is
// the fallback (those are RECORDED). The two are never added
// together anywhere in this module.
function bookingCustomers(booking, events) {
  const evs = events.filter((e) => e && e.bookingId === booking.id && !e.voided);
  const firsts = evs.filter((e) => e.kind !== "return");
  if (evs.length) return { source: "counted", customers: firsts.length };
  const red = booking.redemptions || null;
  if (red && Number(red.count) > 0) return { source: "recorded", customers: Math.floor(Number(red.count) || 0) };
  return { source: "none", customers: 0 };
}

function businessJoinedPlan(bizUser) {
  if (!bizUser || !bizUser.business) return false;
  const b = bizUser.business;
  if (b.accessState === "active") return true;
  const sub = b.subscription;
  return !!(sub && (sub.status === "active" || sub.status === "trialing"));
}

function effectiveStep(pb, bizUser, bookings, posts) {
  if (pb.status === "declined" || pb.status === "completed") return pb.status;
  if (pb.status === "continued") return "continued";
  const mine = linkedBookings(pb, bookings);
  if (businessJoinedPlan(bizUser)) return "continued";
  const myBookingIds = new Set(mine.map((b) => b.id));
  if (posts.some((p) => p && myBookingIds.has(p.bookingId))) return "posted";
  if (mine.some((b) => b.status === "completed" || b.redeemedAt)) return "visited";
  if (mine.length) return "visit_booked";
  return pb.status || "selected";
}

// The numbers for one chosen business, from real records only.
// An unlinked (name-only) business returns its step and spend
// and zero activity, never an invented figure.
function bizResults(pb, ctx) {
  const bizUser = pb.businessId ? ctx.usersById.get(pb.businessId) || null : null;
  const mine = linkedBookings(pb, ctx.bookings);
  const myIds = new Set(mine.map((b) => b.id));
  const posts = ctx.posts.filter((p) => p && myIds.has(p.bookingId));
  let counted = 0;
  let recorded = 0;
  for (const b of mine) {
    const c = bookingCustomers(b, ctx.events);
    if (c.source === "counted") counted += c.customers;
    else if (c.source === "recorded") recorded += c.customers;
  }
  const spendCents = ctx.spends.filter((s) => s.pilotBizId === pb.id).reduce((a, s) => a + (Number(s.amountCents) || 0), 0);
  return {
    id: pb.id,
    businessId: pb.businessId || null,
    name: pb.name || (bizUser && bizUser.business && bizUser.business.businessName) || (bizUser && bizUser.name) || "Business",
    market: pb.marketName || ctx.pilot.marketName,
    linked: !!pb.businessId,
    storedStep: pb.status || "selected",
    step: effectiveStep(pb, bizUser, ctx.bookings, ctx.posts),
    spendCents,
    visitsBooked: mine.length,
    visitsDone: mine.filter((b) => b.status === "completed" || b.redeemedAt).length,
    postsLive: posts.length,
    posts: posts.map((p) => {
      const cr = p.creatorId ? ctx.usersById.get(p.creatorId) || null : null;
      return {
        id: p.id,
        url: p.url || "",
        platform: p.platform || "",
        creatorId: p.creatorId || null,
        creatorName: (cr && cr.name) || "",
        creatorHandle: (cr && cr.creator && cr.creator.handle) || "",
        views: typeof p.views === "number" && Number.isFinite(p.views) ? p.views : null,
        likes: typeof p.likes === "number" && Number.isFinite(p.likes) ? p.likes : null,
        at: p.submittedAt || p.createdAt || null,
      };
    }),
    countedCustomers: counted,
    recordedCustomers: recorded,
    createdAt: pb.createdAt,
  };
}

function fundMath(pilot, spends) {
  const committedCents = Number(pilot.fundCents) || 0;
  const spentCents = spends.reduce((a, s) => a + (Number(s.amountCents) || 0), 0);
  return { committedCents, spentCents, remainingCents: committedCents - spentCents };
}

// Display order for every partner surface (one source, so the
// overview, the list, the results, and the report always agree):
// the businesses furthest along come first, then by name.
const STEP_ORDER = { posted: 0, continued: 1, visited: 2, visit_booked: 3, invited: 4, selected: 5, completed: 6, declined: 7 };
function sortBizRows(rows) {
  return rows.slice().sort((a, b) => ((STEP_ORDER[a.step] ?? 9) - (STEP_ORDER[b.step] ?? 9)) || String(a.name).localeCompare(String(b.name)));
}

function pilotTotals(pilot, ctx) {
  const rows = sortBizRows(ctx.biz.map((pb) => bizResults(pb, ctx)));
  const fund = fundMath(pilot, ctx.spends);
  const counts = {
    businesses: rows.length,
    invited: rows.filter((r) => ["invited", "visit_booked", "visited", "posted", "continued"].includes(r.step)).length,
    visitsBooked: rows.reduce((a, r) => a + r.visitsBooked, 0),
    visitsDone: rows.reduce((a, r) => a + r.visitsDone, 0),
    postsLive: rows.reduce((a, r) => a + r.postsLive, 0),
    countedCustomers: rows.reduce((a, r) => a + r.countedCustomers, 0),
    recordedCustomers: rows.reduce((a, r) => a + r.recordedCustomers, 0),
    continued: rows.filter((r) => r.step === "continued").length,
  };
  return { rows, fund, counts };
}

function pilotView(pilot, ctx) {
  const base = {
    id: pilot.id,
    name: pilot.name,
    partnerName: pilot.partnerName,
    marketId: pilot.marketId,
    marketName: pilot.marketName,
    status: pilot.status,
    createdAt: pilot.createdAt,
    updatedAt: pilot.updatedAt,
  };
  if (!ctx) return base;
  const t = pilotTotals(pilot, ctx);
  return Object.assign(base, { fund: t.fund, counts: t.counts });
}

// ---------------- fund ledger sync ----------------

// The first pilot-linked paid booking of a chosen business
// charges the fund, exactly once, at the creator's listed rate
// that was booked. Idempotent by bookingId: a booking that
// already has its entry never gets a second one.
async function syncAutoSpend(pilot, actorId) {
  const biz = await allPilotBiz(pilot.id);
  const spends = await allPilotSpend(pilot.id);
  const bookings = await allBookings();
  const charged = new Set(spends.filter((s) => s.bookingId).map((s) => s.bookingId));
  let created = 0;
  for (const pb of biz) {
    if (!pb.businessId) continue;
    const mine = linkedBookings(pb, bookings).filter((b) => b.status !== "expired");
    const firstPaid = mine.find((b) => b.kind === "paid" && b.paidLane && Number.isFinite(Number(b.paidLane.rate)));
    if (!firstPaid || charged.has(firstPaid.id)) continue;
    const entry = {
      id: crypto.randomUUID(),
      pilotId: pilot.id,
      pilotBizId: pb.id,
      businessId: pb.businessId,
      amountCents: Math.round(Number(firstPaid.paidLane.rate) * 100),
      bookingId: firstPaid.id,
      kind: "booking",
      note: "First visit, booked through SIGNL",
      date: firstPaid.createdAt || nowIso(),
      createdBy: actorId || null,
      createdAt: nowIso(),
    };
    await store.set(`pilotspend:${pilot.id}:${entry.id}`, entry);
    charged.add(firstPaid.id);
    created += 1;
  }
  return created;
}

// ---------------- partner invite ----------------

async function invitePilotPartner({ pilot, contactName, email, actorId }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!isEmail(cleanEmail)) return { error: "A valid email is required" };
  if (await store.get(`email:${cleanEmail}`)) return { error: "An account with this email already exists" };
  const ts = nowIso();
  const tempPassword = crypto.randomBytes(24).toString("hex");
  const { salt, hash } = auth.hashPassword(tempPassword);
  const user = {
    id: crypto.randomUUID(),
    role: "pilot_partner",
    email: cleanEmail,
    name: String(contactName || pilot.partnerName || "").trim().slice(0, 80),
    passwordSalt: salt,
    passwordHash: hash,
    status: "approved",
    tester: false,
    market: pilot.marketName,
    createdAt: ts,
    updatedAt: ts,
    reviewedAt: ts,
    reviewedBy: actorId || null,
    termsVersion: null,
    termsAcceptedAt: ts,
    creator: null,
    business: null,
    pilotId: pilot.id,
    pilotPartner: { partnerName: pilot.partnerName, pilotName: pilot.name },
  };
  await store.set(`user:${user.id}`, user);
  await store.set(`email:${cleanEmail}`, { userId: user.id });
  let emailSent = false;
  let token = null;
  if (deps.issuePasswordResetToken && deps.passwordResetEmail && deps.deliverEmail) {
    token = await deps.issuePasswordResetToken(user);
    const base = process.env.APP_URL || "https://app.joinsignl.com";
    const mail = deps.passwordResetEmail(user, `${base}/?reset=${token}`);
    const sent = await deps.deliverEmail("password_reset", user, mail.subject, mail.text, null);
    emailSent = !!(sent && sent.sent);
  }
  await logEvent({ type: "pilot_partner_invited", actorId: actorId || null, actorRole: "admin", subjectId: user.id, market: pilot.marketName, data: { pilotId: pilot.id, partnerName: pilot.partnerName, email: cleanEmail, emailSent } });
  return { user, emailSent, token };
}

async function sendPartnerInviteEmail(user, actorId, pilot) {
  let emailSent = false;
  let token = null;
  if (deps.issuePasswordResetToken && deps.passwordResetEmail && deps.deliverEmail) {
    token = await deps.issuePasswordResetToken(user);
    const base = process.env.APP_URL || "https://app.joinsignl.com";
    const mail = deps.passwordResetEmail(user, `${base}/?reset=${token}`);
    const sent = await deps.deliverEmail("password_reset", user, mail.subject, mail.text, null);
    emailSent = !!(sent && sent.sent);
  }
  await logEvent({ type: "pilot_partner_invite_resent", actorId: actorId || null, actorRole: "admin", subjectId: user.id, market: pilot.marketName, data: { pilotId: pilot.id, emailSent } });
  return { emailSent, token };
}

// ---------------- partner API (read-only) ----------------

async function pilotForUser(user) {
  if (!user || user.role !== "pilot_partner" || !user.pilotId) return null;
  return pilotById(user.pilotId);
}

async function handlePilotApi({ method, seg, user }) {
  if (!user) return err(401, "Sign in first");
  if (user.role !== "pilot_partner") return err(403, "The Impact Portal is for SIGNL pilot partners.");
  const pilot = await pilotForUser(user);
  if (!pilot) return err(404, "Your pilot is not set up yet. Email jeff@joinsignl.com and we will sort it out.");
  if (method !== "GET") return err(405, "The Impact Portal is read-only: it shows where the fund went. Email jeff@joinsignl.com if something looks wrong.");
  const sub = seg[1] || "me";
  await syncAutoSpend(pilot, user.id);
  const ctx = await pilotContext(pilot);

  if (sub === "me") {
    return json(200, {
      partner: { name: user.name || "", partnerName: pilot.partnerName, email: user.email },
      pilot: pilotView(pilot, null),
    });
  }
  if (sub === "overview") {
    const t = pilotTotals(pilot, ctx);
    return json(200, { pilot: pilotView(pilot, null), fund: t.fund, counts: t.counts });
  }
  if (sub === "businesses") {
    const t = pilotTotals(pilot, ctx);
    return json(200, {
      pilot: pilotView(pilot, null),
      businesses: t.rows.map((r) => ({
        id: r.id, name: r.name, market: r.market, linked: r.linked,
        step: r.step, stepLabel: STEP_LABELS[r.step] || r.step,
        spendCents: r.spendCents, visitsBooked: r.visitsBooked, visitsDone: r.visitsDone, postsLive: r.postsLive,
      })),
    });
  }
  if (sub === "results") {
    const t = pilotTotals(pilot, ctx);
    return json(200, {
      pilot: pilotView(pilot, null),
      businesses: t.rows.map((r) => ({
        id: r.id, name: r.name, market: r.market,
        step: r.step, stepLabel: STEP_LABELS[r.step] || r.step,
        visitsBooked: r.visitsBooked, visitsDone: r.visitsDone,
        posts: r.posts, countedCustomers: r.countedCustomers, recordedCustomers: r.recordedCustomers,
      })),
      totals: { countedCustomers: t.counts.countedCustomers, recordedCustomers: t.counts.recordedCustomers, postsLive: t.counts.postsLive, visitsDone: t.counts.visitsDone },
    });
  }
  if (sub === "report") {
    const t = pilotTotals(pilot, ctx);
    return json(200, {
      pilot: pilotView(pilot, null),
      generatedAt: nowIso(),
      period: { from: pilot.createdAt, to: pilot.status === "closed" ? pilot.updatedAt : nowIso() },
      fund: t.fund,
      counts: t.counts,
      businesses: t.rows.map((r) => ({
        name: r.name, step: r.step, stepLabel: STEP_LABELS[r.step] || r.step,
        spendCents: r.spendCents, visitsDone: r.visitsDone, postsLive: r.postsLive,
        countedCustomers: r.countedCustomers, recordedCustomers: r.recordedCustomers,
      })),
    });
  }
  return err(404, "Not found");
}

// ---------------- admin API ----------------

async function adminPilotDetail(pilot) {
  await syncAutoSpend(pilot, null);
  const ctx = await pilotContext(pilot);
  const t = pilotTotals(pilot, ctx);
  const users = deps.allUsers ? await deps.allUsers() : [];
  const inPilot = new Set(ctx.biz.map((pb) => pb.businessId).filter(Boolean));
  const candidates = users
    .filter((u) => u.role === "business" && u.business && normalizeMarketName(u.market || "") === pilot.marketName && !inPilot.has(u.id))
    .map((u) => ({ id: u.id, name: (u.business && u.business.businessName) || u.name || "Business", market: u.market }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const partnerUser = pilot.partnerUserId ? ctx.usersById.get(pilot.partnerUserId) || null : null;
  return {
    pilot: Object.assign(pilotView(pilot, null), {
      fundCents: Number(pilot.fundCents) || 0,
      partnerUserId: pilot.partnerUserId || null,
      partnerEmail: partnerUser ? partnerUser.email : null,
      partnerLoginName: partnerUser ? partnerUser.name : null,
      createdBy: pilot.createdBy || null,
    }),
    fund: t.fund,
    counts: t.counts,
    businesses: t.rows.map((r) => Object.assign(r, { posts: undefined })),
    spends: ctx.spends.slice().sort((a, b) => String(a.date || a.createdAt).localeCompare(String(b.date || b.createdAt))),
    candidates,
  };
}

async function handleAdminPilots({ method, seg, event, user }) {
  // seg: ["admin", "pilots", ...]
  if (seg.length === 2 && method === "GET") {
    const pilots = await allPilots();
    const out = [];
    for (const p of pilots) {
      await syncAutoSpend(p, user.id);
      const ctx = await pilotContext(p);
      out.push(pilotView(p, ctx));
    }
    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return json(200, { pilots: out, markets: MARKETS.map((m) => ({ id: m.id, name: m.name })) });
  }

  if (seg.length === 2 && method === "POST") {
    const b = parseBody(event);
    const partnerName = String(b.partnerName || "").trim().slice(0, 100);
    const contactName = String(b.contactName || "").trim().slice(0, 80);
    const email = String(b.email || "").trim().toLowerCase();
    const mkt = marketByNameLoose(b.market || "");
    const fundCents = dollarsToCents(b.fund);
    if (!partnerName) return err(400, "The partner's name is required");
    if (!isEmail(email)) return err(400, "A valid login email is required");
    if (!mkt) return err(400, "Unknown market");
    if (fundCents === null) return err(400, "The fund amount must be a number of dollars, 0 or more");
    const ts = nowIso();
    const pilot = {
      id: crypto.randomUUID(),
      name: String(b.name || "").trim().slice(0, 100) || `${mkt.name} Pilot`,
      partnerName,
      marketId: mkt.id,
      marketName: mkt.name,
      fundCents,
      status: "active",
      partnerUserId: null,
      createdBy: user.id,
      createdAt: ts,
      updatedAt: ts,
    };
    const invited = await invitePilotPartner({ pilot, contactName, email, actorId: user.id });
    if (invited.error) return err(400, invited.error);
    pilot.partnerUserId = invited.user.id;
    await store.set(`pilot:${pilot.id}`, pilot);
    await logEvent({ type: "pilot_created", actorId: user.id, actorRole: "admin", subjectId: pilot.id, market: mkt.name, data: { partnerName, fundCents, emailSent: invited.emailSent } });
    const out = { ok: true, pilot: pilotView(pilot, null), emailSent: invited.emailSent };
    if (testModeOn()) out.devResetToken = invited.token;
    return json(200, out);
  }

  const pilot = await pilotById(seg[2]);
  if (!pilot) return err(404, "Pilot not found");

  if (seg.length === 3 && method === "GET") {
    return json(200, await adminPilotDetail(pilot));
  }

  if (seg.length === 3 && method === "PATCH") {
    const b = parseBody(event);
    if (b.status !== undefined) {
      if (!PILOT_STATUSES.includes(b.status)) return err(400, "status must be active or closed");
      pilot.status = b.status;
    }
    if (b.fund !== undefined) {
      const fundCents = dollarsToCents(b.fund);
      if (fundCents === null) return err(400, "The fund amount must be a number of dollars, 0 or more");
      pilot.fundCents = fundCents;
    }
    if (typeof b.name === "string" && b.name.trim()) pilot.name = b.name.trim().slice(0, 100);
    if (typeof b.partnerName === "string" && b.partnerName.trim()) pilot.partnerName = b.partnerName.trim().slice(0, 100);
    pilot.updatedAt = nowIso();
    await store.set(`pilot:${pilot.id}`, pilot);
    await logEvent({ type: "pilot_updated", actorId: user.id, actorRole: "admin", subjectId: pilot.id, market: pilot.marketName, data: { status: pilot.status, fundCents: pilot.fundCents } });
    return json(200, { ok: true, pilot: pilotView(pilot, null) });
  }

  if (seg.length === 4 && seg[3] === "resend-invite" && method === "POST") {
    if (!pilot.partnerUserId) return err(404, "This pilot has no partner login yet");
    const target = await store.get(`user:${pilot.partnerUserId}`);
    if (!target) return err(404, "Partner account not found");
    const sent = await sendPartnerInviteEmail(target, user.id, pilot);
    const out = { ok: true, emailSent: sent.emailSent };
    if (testModeOn()) out.devResetToken = sent.token;
    return json(200, out);
  }

  if (seg.length === 4 && seg[3] === "businesses" && method === "POST") {
    const b = parseBody(event);
    const existing = await allPilotBiz(pilot.id);
    const ts = nowIso();
    let pb = null;
    if (b.businessId) {
      const target = await store.get(`user:${b.businessId}`);
      if (!target || target.role !== "business") return err(404, "Business not found");
      if (existing.some((x) => x.businessId === target.id)) return err(409, "That business is already in this pilot.");
      pb = {
        id: crypto.randomUUID(),
        pilotId: pilot.id,
        businessId: target.id,
        name: (target.business && target.business.businessName) || target.name || "Business",
        marketName: target.market || pilot.marketName,
        status: "selected",
        createdBy: user.id,
        createdAt: ts,
        updatedAt: ts,
      };
    } else {
      const name = String(b.name || "").trim().slice(0, 100);
      if (!name) return err(400, "Pick a business on SIGNL, or type the business's name.");
      if (existing.some((x) => !x.businessId && x.name.toLowerCase() === name.toLowerCase())) return err(409, "That business is already in this pilot.");
      pb = {
        id: crypto.randomUUID(),
        pilotId: pilot.id,
        businessId: null,
        name,
        marketName: pilot.marketName,
        status: "selected",
        createdBy: user.id,
        createdAt: ts,
        updatedAt: ts,
      };
    }
    await store.set(`pilotbiz:${pilot.id}:${pb.id}`, pb);
    await logEvent({ type: "pilot_business_added", actorId: user.id, actorRole: "admin", subjectId: pilot.id, market: pilot.marketName, data: { pilotBizId: pb.id, businessId: pb.businessId, name: pb.name } });
    await syncAutoSpend(pilot, user.id);
    return json(200, { ok: true, business: pb });
  }

  if (seg.length === 6 && seg[3] === "businesses" && method === "POST") {
    const pb = await store.get(`pilotbiz:${pilot.id}:${seg[4]}`);
    if (!pb) return err(404, "That business is not in this pilot");
    if (seg[5] === "status") {
      const b = parseBody(event);
      if (!STORED_STEPS.includes(b.status)) return err(400, `status must be one of: ${STORED_STEPS.join(", ")}`);
      pb.status = b.status;
      pb.updatedAt = nowIso();
      await store.set(`pilotbiz:${pilot.id}:${pb.id}`, pb);
      await logEvent({ type: "pilot_business_status", actorId: user.id, actorRole: "admin", subjectId: pilot.id, market: pilot.marketName, data: { pilotBizId: pb.id, name: pb.name, status: b.status } });
      return json(200, { ok: true, business: pb });
    }
    if (seg[5] === "remove") {
      await store.del(`pilotbiz:${pilot.id}:${pb.id}`);
      await logEvent({ type: "pilot_business_removed", actorId: user.id, actorRole: "admin", subjectId: pilot.id, market: pilot.marketName, data: { pilotBizId: pb.id, name: pb.name } });
      return json(200, { ok: true });
    }
    return err(404, "Not found");
  }

  if (seg.length === 4 && seg[3] === "spend" && method === "POST") {
    const b = parseBody(event);
    const amountCents = dollarsToCents(b.amount);
    if (amountCents === null || amountCents <= 0) return err(400, "The amount must be more than 0 dollars");
    let pb = null;
    if (b.pilotBizId) {
      pb = await store.get(`pilotbiz:${pilot.id}:${b.pilotBizId}`);
      if (!pb) return err(404, "That business is not in this pilot");
    }
    const dateRaw = typeof b.date === "string" && b.date.trim() ? b.date.trim() : nowIso();
    const entry = {
      id: crypto.randomUUID(),
      pilotId: pilot.id,
      pilotBizId: pb ? pb.id : null,
      businessId: pb ? pb.businessId : null,
      amountCents,
      bookingId: null,
      kind: "manual",
      note: String(b.note || "").trim().slice(0, 200),
      date: dateRaw,
      createdBy: user.id,
      createdAt: nowIso(),
    };
    await store.set(`pilotspend:${pilot.id}:${entry.id}`, entry);
    await logEvent({ type: "pilot_spend_added", actorId: user.id, actorRole: "admin", subjectId: pilot.id, market: pilot.marketName, data: { spendId: entry.id, pilotBizId: entry.pilotBizId, amountCents, note: entry.note } });
    return json(200, { ok: true, spend: entry });
  }

  if (seg.length === 6 && seg[3] === "spend" && seg[5] === "remove" && method === "POST") {
    const entry = await store.get(`pilotspend:${pilot.id}:${seg[4]}`);
    if (!entry) return err(404, "Ledger entry not found");
    if (entry.kind === "booking") return err(400, "Booking entries come from the booking itself and cannot be removed here. Manual entries can.");
    await store.del(`pilotspend:${pilot.id}:${entry.id}`);
    await logEvent({ type: "pilot_spend_removed", actorId: user.id, actorRole: "admin", subjectId: pilot.id, market: pilot.marketName, data: { spendId: entry.id, amountCents: entry.amountCents } });
    return json(200, { ok: true });
  }

  return err(404, "Not found");
}

module.exports = {
  init,
  handlePilotApi,
  handleAdminPilots,
  pilotForUser,
  invitePilotPartner,
  syncAutoSpend,
  STEP_LABELS,
  STORED_STEPS,
  _test: { allPilots, allPilotBiz, allPilotSpend, fundMath, bizResults, effectiveStep, linkedBookings, bookingCustomers },
};
