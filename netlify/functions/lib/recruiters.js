// Staff recruiters + prospect queues (Build -70, Jeff, 2026-11-02):
// the outreach console. A staff recruiter (Bella in Dubai) gets a
// login scoped to ONE market, a queue of creator prospects for
// that market, a ready Sig-drafted message per person per channel,
// and an honest send flow: she copies the draft, sends it from her
// own Instagram / TikTok / email (the platforms allow no in-app
// cold DMs), and marks it sent here. Jeff works the same console
// from inside Admin for his own markets through an "owner"
// recruiter entity, so there is exactly one system, not two.
//
// Records:
//   recruiter:{id}        a recruiter entity: { kind: "staff" |
//                         "owner", userId (staff login; null for
//                         the owner anchor), name, email, code,
//                         marketId, marketName, markets (names the
//                         entity may work), status, createdAt }
//   prospect:{id}         one queued creator: identity + handles,
//                         market, assigned recruiterId (an entity
//                         id, or "seat:<marketId>" before a staff
//                         recruiter holds that market), status,
//                         sends log, follow-up state, draft
//                         overrides, linkedUserId once they sign
//                         up, and the credit mirror.
//   rcredit:{id}          the exactly-once credit ledger: one
//                         record per credited sign-up, ever.
//                         { recruiterId, userId, handle, market,
//                         via: "link" | "list-match", prospectId,
//                         at }. Rollups count THESE, so a sign-up
//                         can never count twice.
//   user.recruiterId      stamped on a creator who signed up
//                         through a recruiter link (the FK, like
//                         partnerId; signupSource keeps the raw
//                         "recruiter-<code>" string).
//
// Attribution law (Jeff, 2026-11-02): the recruiter's own link is
// primary. A sign-up whose handle matches a prospect on a
// recruiter's list ALSO flips that prospect to claimed and
// credits the list's recruiter when no link says otherwise. If
// link and list-match disagree, the link wins and the match is
// flagged on the prospect (creditConflict) for the Admin rollup.
// Nothing here ever sends a message: drafts are copy-and-send by
// the human, always.

const crypto = require("crypto");
const store = require("./store");
const auth = require("./auth");
const { logEvent } = require("./events");
const { MARKETS, normalizeMarketName } = require("./markets");

const RECRUITER_SRC_PREFIX = "recruiter-";
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
const SEED_FLAG_KEY = "config:recruiterSeedsV1";
// Jeff's own markets for the Admin outreach workspace: the four
// brain-store markets plus the three seeded cities.
const OWNER_MARKETS = ["Austin", "Nashville", "Richmond", "Virginia Beach", "Denver", "Dallas", "Chicago"];
const PROSPECT_STATUSES = ["to_contact", "sent", "replied", "claimed", "approved", "not_interested", "do_not_contact"];
const ADVERTISER_PERMIT_STATUSES = ["not_started", "in_progress", "done"];
const DUBAI_PERMIT_LINE = "Dubai note: the UAE requires an Advertiser Permit before your first paid or gifted post. You do not need it to claim your page, and SIGNL walks founding creators through it.";

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

// Same normalization the router applies to claim handles.
function normalizeHandle(raw) {
  let h = String(raw == null ? "" : raw).trim();
  if (!h) return "";
  if (h.includes("/")) {
    h = h.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    const parts = h.split(/[/?#]/).map((x) => x.trim()).filter(Boolean);
    h = parts.length ? parts[parts.length - 1] : "";
  }
  return h.replace(/^@/, "").trim();
}
function handleKey(raw) { return normalizeHandle(raw).toLowerCase(); }

function marketByNameLoose(name) {
  const n = normalizeMarketName(name || "");
  return MARKETS.find((m) => m.name === n) || MARKETS.find((m) => m.id === String(name || "").toLowerCase()) || null;
}
function seatIdFor(marketId) { return `seat:${marketId}`; }

async function allEntities() {
  const rows = await store.list("recruiter:");
  return rows.map((r) => r.value).filter(Boolean);
}
async function entityById(id) {
  if (!id) return null;
  return store.get(`recruiter:${id}`);
}
async function entityByCode(code) {
  if (!code) return null;
  const all = await allEntities();
  return all.find((e) => e.code === code && e.status !== "disabled") || null;
}
async function entityForUser(user) {
  if (!user) return null;
  if (user.role === "admin") return ensureOwnerEntity();
  if (user.role !== "recruiter") return null;
  if (user.recruiterEntityId) {
    const e = await entityById(user.recruiterEntityId);
    if (e) return e;
  }
  const all = await allEntities();
  return all.find((e) => e.kind === "staff" && e.userId === user.id) || null;
}

async function ensureOwnerEntity() {
  const all = await allEntities();
  const existing = all.find((e) => e.kind === "owner");
  if (existing) return existing;
  const ts = nowIso();
  const entity = {
    id: crypto.randomUUID(),
    kind: "owner",
    userId: null,
    name: "Jeff",
    email: "",
    code: "jeff",
    marketId: (marketByNameLoose(OWNER_MARKETS[0]) || {}).id || "austin",
    marketName: OWNER_MARKETS[0],
    markets: OWNER_MARKETS.slice(),
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  };
  await store.set(`recruiter:${entity.id}`, entity);
  return entity;
}

function codeFromName(name, taken) {
  const base = String(name || "recruiter").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "recruiter";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function entityView(e) {
  if (!e) return null;
  return {
    id: e.id, kind: e.kind, name: e.name, email: e.email, code: e.code,
    marketId: e.marketId, marketName: e.marketName, markets: e.markets || [e.marketName],
    status: e.status, claimSrc: RECRUITER_SRC_PREFIX + e.code, createdAt: e.createdAt,
    sponsorPartnerId: e.sponsorPartnerId || null, userId: e.userId || null,
  };
}

// ---------------- prospects ----------------

async function allProspects() {
  const rows = await store.list("prospect:");
  return rows.map((r) => r.value).filter(Boolean);
}

function prospectHandles(p) {
  const out = new Set();
  if (p.handle) out.add(handleKey(p.handle));
  if (p.instagramHandle) out.add(handleKey(p.instagramHandle));
  if (p.tiktokHandle) out.add(handleKey(p.tiktokHandle));
  out.delete("");
  return out;
}

// A creator record that matches this prospect, if one exists:
// dedupe against real sign-ups is by handle, the way claims are.
async function findCreatorForProspect(p, users) {
  const keys = prospectHandles(p);
  if (!keys.size) return null;
  const list = users || (deps.allUsers ? await deps.allUsers() : []);
  return list.find((u) => u.role === "creator" && u.creator && keys.has(handleKey(u.creator.handle))) || null;
}

async function effectiveStatus(p, users) {
  if (p.status === "claimed" || p.status === "approved") {
    const linked = p.linkedUserId && users ? users.find((u) => u.id === p.linkedUserId) : null;
    if (linked && linked.status === "approved") return "approved";
    if (p.status === "approved") return "approved";
    return "claimed";
  }
  return p.status;
}

function followupReady(p, nowMs) {
  if (p.status !== "sent" || p.followupSentAt || !p.firstSentAt) return false;
  return nowMs - Date.parse(p.firstSentAt) >= FOUR_DAYS_MS;
}

function prospectView(p, users, nowMs) {
  const sends = Array.isArray(p.sends) ? p.sends : [];
  return {
    id: p.id,
    market: p.marketName, marketId: p.marketId,
    recruiterId: p.recruiterId,
    name: p.name || "",
    handle: p.handle || "",
    instagramHandle: p.instagramHandle || "",
    instagramUrl: p.instagramUrl || (p.instagramHandle ? `https://www.instagram.com/${p.instagramHandle}/` : ""),
    tiktokHandle: p.tiktokHandle || "",
    tiktokUrl: p.tiktokUrl || (p.tiktokHandle ? `https://www.tiktok.com/@${p.tiktokHandle}` : ""),
    email: p.email || "",
    creatorMarketUrl: p.creatorMarketUrl || "",
    category: p.category || "",
    followers: typeof p.followers === "number" ? p.followers : null,
    followersPlatform: p.followersPlatform || "",
    city: p.city || "",
    source: p.source || "",
    belowMinimum: p.belowMinimum === true,
    status: p.status,
    effectiveStatus: null, // filled by caller when users are loaded
    alreadyOnSignl: p.alreadyOnSignl === true,
    linkedUserId: p.linkedUserId || null,
    sends,
    firstSentAt: p.firstSentAt || null,
    followupSentAt: p.followupSentAt || null,
    followupReady: followupReady(p, nowMs),
    followupUnlocksAt: p.status === "sent" && !p.followupSentAt && p.firstSentAt ? new Date(Date.parse(p.firstSentAt) + FOUR_DAYS_MS).toISOString() : null,
    repliedAt: p.repliedAt || null,
    claimedAt: p.claimedAt || null,
    credit: p.credit || null,
    creditConflict: p.creditConflict || null,
    hasDraftEdits: !!(p.drafts && Object.keys(p.drafts).length),
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function normalizeProspectInput(raw, marketName, recruiterId, source) {
  const ig = normalizeHandle(raw.instagramHandle || raw.instagram_handle || "");
  const tk = normalizeHandle(raw.tiktokHandle || raw.tiktok_handle || "");
  const generic = normalizeHandle(raw.handle || "");
  const handle = generic || ig || tk;
  const email = typeof (raw.email) === "string" && isEmail(raw.email.trim()) ? raw.email.trim().toLowerCase() : "";
  const mkt = marketByNameLoose(marketName || raw.market || "");
  const followersRaw = raw.followers != null ? Number(raw.followers) : null;
  return {
    marketName: mkt ? mkt.name : (marketName || ""),
    marketId: mkt ? mkt.id : "",
    recruiterId,
    name: String(raw.name || "").trim().slice(0, 80),
    handle,
    instagramHandle: ig || (generic && !tk ? generic : ig),
    instagramUrl: String(raw.instagramUrl || raw.instagram_url || "").trim().slice(0, 300),
    tiktokHandle: tk || "",
    tiktokUrl: String(raw.tiktokUrl || raw.tiktok_url || "").trim().slice(0, 300),
    email,
    emailSource: String(raw.emailSource || raw.email_evidence || "").trim().slice(0, 300),
    creatorMarketUrl: String(raw.creatorMarketUrl || "").trim().slice(0, 300),
    category: String(raw.category || "").trim().slice(0, 60),
    followers: Number.isFinite(followersRaw) ? followersRaw : null,
    followersPlatform: String(raw.followersPlatform || raw.followers_platform || "").trim().slice(0, 30),
    city: String(raw.city || raw.city_base || "").trim().slice(0, 60),
    source: source || String(raw.source || "manual").slice(0, 60),
    belowMinimum: raw.belowMinimum === true || (Number.isFinite(followersRaw) && followersRaw !== null && followersRaw > 0 && followersRaw < 500),
  };
}

// Import a batch into one queue. Dedupe law: within the same
// market, a handle (any platform) or an email that is already
// queued is never queued twice; a queued do_not_contact blocks
// re-adding the same person; a handle that already belongs to a
// real creator record lands pre-linked as already-on-SIGNL.
async function importProspects({ marketName, recruiterId, records, source, actorId }) {
  const existing = await allProspects();
  const users = deps.allUsers ? await deps.allUsers() : [];
  const inMarket = existing.filter((p) => p.marketName === (marketByNameLoose(marketName) || {}).name || p.marketName === marketName);
  const byHandle = new Map();
  const byEmail = new Map();
  for (const p of inMarket) {
    for (const k of prospectHandles(p)) byHandle.set(k, p);
    if (p.email) byEmail.set(p.email, p);
  }
  const creatorsByHandle = new Map();
  for (const u of users) {
    if (u.role === "creator" && u.creator && u.creator.handle) creatorsByHandle.set(handleKey(u.creator.handle), u);
  }
  const out = { added: 0, skippedDuplicate: 0, blockedDoNotContact: 0, alreadyOnSignl: 0, skippedInvalid: 0 };
  const ts = nowIso();
  for (const raw of records || []) {
    const n = normalizeProspectInput(raw, marketName, recruiterId, source);
    const keys = new Set();
    if (n.handle) keys.add(handleKey(n.handle));
    if (n.instagramHandle) keys.add(handleKey(n.instagramHandle));
    if (n.tiktokHandle) keys.add(handleKey(n.tiktokHandle));
    keys.delete("");
    if (!keys.size && !n.email) { out.skippedInvalid += 1; continue; }
    let dupe = null;
    for (const k of keys) { if (byHandle.has(k)) { dupe = byHandle.get(k); break; } }
    if (!dupe && n.email && byEmail.has(n.email)) dupe = byEmail.get(n.email);
    if (dupe) {
      if (dupe.status === "do_not_contact") out.blockedDoNotContact += 1;
      else out.skippedDuplicate += 1;
      continue;
    }
    let creator = null;
    for (const k of keys) { if (creatorsByHandle.has(k)) { creator = creatorsByHandle.get(k); break; } }
    const p = Object.assign({}, n, {
      id: crypto.randomUUID(),
      status: "to_contact",
      sends: [],
      firstSentAt: null,
      followupSentAt: null,
      repliedAt: null,
      claimedAt: null,
      linkedUserId: null,
      alreadyOnSignl: false,
      credit: null,
      creditConflict: null,
      drafts: null,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actorId || null,
    });
    // Legacy contact state from an imported list (the brain store
    // carries who was already emailed or DM'd, so nobody already
    // contacted queues as fresh).
    const legacy = String(raw.contact_state || raw.contactState || "").toLowerCase();
    if (legacy === "dm_sent" || legacy === "emailed" || legacy === "sent") {
      p.status = "sent";
      p.sends = [{ channel: legacy === "emailed" ? "email" : "instagram", at: null, kind: "first", legacy: true }];
    } else if (legacy === "replied") { p.status = "replied"; p.repliedAt = null; }
    else if (legacy === "claimed") { p.status = "claimed"; }
    else if (legacy === "approved") { p.status = "approved"; }
    else if (legacy === "declined" || legacy === "not_interested") { p.status = "not_interested"; }
    else if (legacy === "permanent_fail" || legacy === "do_not_contact") { p.status = "do_not_contact"; }
    if (creator) {
      p.alreadyOnSignl = true;
      p.linkedUserId = creator.id;
      if (p.status === "to_contact" || p.status === "sent" || p.status === "replied") p.status = creator.status === "approved" ? "approved" : "claimed";
      if (creator.status === "approved") p.status = "approved";
      p.claimedAt = p.claimedAt || ts;
      out.alreadyOnSignl += 1;
    }
    await store.set(`prospect:${p.id}`, p);
    for (const k of keys) byHandle.set(k, p);
    if (p.email) byEmail.set(p.email, p);
    out.added += 1;
  }
  return out;
}

// ---------------- drafts ----------------

function firstNameOf(name) {
  const t = String(name || "").trim().split(/\s+/)[0];
  return t || "there";
}

function claimLinkFor(entity, p, channel) {
  const h = channel === "tiktok" && p.tiktokHandle ? p.tiktokHandle : (p.instagramHandle || p.handle || p.tiktokHandle || "");
  const base = process.env.APP_URL || "https://app.joinsignl.com";
  return `${base}/claim?handle=${encodeURIComponent(h)}&market=${encodeURIComponent(p.marketName)}&src=${encodeURIComponent(RECRUITER_SRC_PREFIX + entity.code)}`;
}

function senderIntro(entity) {
  if (entity.kind === "owner") return "I'm Jeff, the founder of SIGNL.";
  return `I'm ${firstNameOf(entity.name)}. I lead SIGNL's launch in ${entity.marketName}.`;
}
function senderSignoff(entity) {
  if (entity.kind === "owner") return "Jeff\nFounder, SIGNL";
  return `${firstNameOf(entity.name)}\nSIGNL ${entity.marketName}`;
}

// The approved founding scripts (goal files, 2026-11-02), with the
// market and sender substituted. Canon in every first message:
// both lanes in one breath, the 97% keep, ranked by local audience
// not follower count, the founding roster, free for creators, the
// 500 total followers minimum. No launch dates, no em dashes.
function buildDrafts(entity, p) {
  const first = firstNameOf(p.name);
  const market = p.marketName;
  const category = (p.category || "local").toLowerCase();
  const intro = senderIntro(entity);
  const dmFor = (channel) => {
    const link = claimLinkFor(entity, p, channel);
    return `Hi ${first}, ${intro}

SIGNL books local creators with local businesses: comped experiences like meals, treatments, and stays, or paid bookings at your own rate, and you keep 97% of paid bookings.

You are ranked by how local your audience is to ${market}, not by follower count, so ${category} creators here get seen first.

${market} opens after the founding roster is set, and claiming your page now holds your spot. It is free for creators, and SIGNL starts at 500 total followers across your platforms.

Your page: ${link}`;
  };
  const emailLink = claimLinkFor(entity, p, "instagram");
  const emailBody = `Hi ${first},

${intro} I am putting together the founding creator roster before the market opens.

SIGNL connects local creators with local businesses in the same city. Businesses book you two ways: for comped experiences, like a meal, a treatment, a class, or a stay, in exchange for a post about the real visit; or for paid bookings at the rate you set yourself. On paid bookings you keep 97%. SIGNL takes 3%, and that is the whole split.

What makes SIGNL different is the ranking. Creators are ranked by how local their audience is, not by follower count. For a ${category} creator in ${market}, that means the businesses here see you ahead of bigger accounts whose audiences live somewhere else.

${market} opens once the founding roster is set. Claiming your page now holds your spot and your local ranking, and it costs nothing to be on the roster. Joining is free for creators, and always is. SIGNL starts at 500 total followers across your platforms.

Claim your page here: ${emailLink}
${p.marketId === "dubai" ? `\n${DUBAI_PERMIT_LINE}\n` : ""}
Happy to answer anything. Just reply here.

${senderSignoff(entity)}`;
  const followup = `Hi ${first}, quick follow-up from ${entity.kind === "owner" ? "Jeff" : firstNameOf(entity.name)} at SIGNL. Your founding page for ${market} is still open to claim: ${claimLinkFor(entity, p, "instagram")}

It holds your spot and your local ranking for when ${market} opens. Free for creators, and paid bookings always pay you 97% at your own rate.`;
  return {
    ig: dmFor("instagram"),
    tiktok: dmFor("tiktok"),
    emailSubject: `${market}'s founding creators`,
    emailBody,
    followup,
  };
}

function draftsFor(entity, p) {
  const generated = buildDrafts(entity, p);
  const o = p.drafts || {};
  return {
    ig: o.ig || generated.ig,
    tiktok: o.tiktok || generated.tiktok,
    emailSubject: o.emailSubject || generated.emailSubject,
    emailBody: o.emailBody || generated.emailBody,
    followup: o.followup || generated.followup,
    edited: {
      ig: !!o.ig, tiktok: !!o.tiktok, emailSubject: !!o.emailSubject, emailBody: !!o.emailBody, followup: !!o.followup,
    },
    claimLink: claimLinkFor(entity, p, "instagram"),
  };
}

// ---------------- credit ----------------

async function creditForUser(userId) {
  const rows = await store.list("rcredit:");
  return rows.map((r) => r.value).find((c) => c && c.userId === userId) || null;
}

async function resolveProspectOwner(p, entities) {
  if (!p) return null;
  if (p.recruiterId && !String(p.recruiterId).startsWith("seat:")) {
    return entities.find((e) => e.id === p.recruiterId) || null;
  }
  if (p.recruiterId && String(p.recruiterId).startsWith("seat:")) {
    const marketId = String(p.recruiterId).slice(5);
    return entities.find((e) => e.kind === "staff" && e.marketId === marketId && e.status !== "disabled") || null;
  }
  return null;
}

// The sign-up hook (called from handleRegister for creators; it
// never throws and never blocks a sign-up). Link attribution is
// read from the raw signupSource the registration already stored.
async function onCreatorRegistered(user) {
  try {
    if (!user || user.role !== "creator" || !user.creator) return;
    const handle = handleKey(user.creator.handle);
    if (!handle) return;
    const src = typeof user.signupSource === "string" ? user.signupSource : "";
    let linkEntity = null;
    if (src.startsWith(RECRUITER_SRC_PREFIX)) {
      linkEntity = await entityByCode(src.slice(RECRUITER_SRC_PREFIX.length));
    }
    let credit = await creditForUser(user.id);
    if (linkEntity && !credit) {
      // Stamp the FK on the creator record, like partnerId.
      const fresh = await store.get(`user:${user.id}`);
      if (fresh && !fresh.recruiterId) {
        fresh.recruiterId = linkEntity.id;
        fresh.updatedAt = nowIso();
        await store.set(`user:${user.id}`, fresh);
      }
    }
    const entities = await allEntities();
    const prospects = (await allProspects()).filter((p) => p.marketName === user.market && prospectHandles(p).has(handle));
    let creditedViaProspect = false;
    for (const p of prospects) {
      if (p.linkedUserId && p.linkedUserId !== user.id) continue;
      if (p.status === "to_contact" || p.status === "sent" || p.status === "replied") {
        p.status = "claimed";
        p.claimedAt = p.claimedAt || nowIso();
      }
      p.linkedUserId = user.id;
      p.alreadyOnSignl = true;
      const owner = await resolveProspectOwner(p, entities);
      if (!credit) {
        const winner = linkEntity || owner;
        if (winner) {
          credit = {
            id: crypto.randomUUID(),
            recruiterId: winner.id,
            userId: user.id,
            handle: user.creator.handle,
            market: user.market,
            via: linkEntity ? "link" : "list-match",
            prospectId: p.id,
            at: nowIso(),
          };
          await store.set(`rcredit:${credit.id}`, credit);
          p.credit = { recruiterId: winner.id, via: credit.via, at: credit.at };
          creditedViaProspect = true;
          if (linkEntity && owner && owner.id !== linkEntity.id && !p.creditConflict) {
            p.creditConflict = { listMatchRecruiterId: owner.id, linkRecruiterId: linkEntity.id, userId: user.id, at: nowIso() };
          }
          await logEvent({ type: "recruiter_signup_credit", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { recruiterId: winner.id, via: credit.via, prospectId: p.id, handle: user.creator.handle } });
        }
      } else if (linkEntity && owner && credit.recruiterId !== owner.id && !p.creditConflict) {
        // Already credited (link won earlier): flag the list match.
        p.creditConflict = { listMatchRecruiterId: owner.id, linkRecruiterId: credit.recruiterId, userId: user.id, at: nowIso() };
      }
      p.updatedAt = nowIso();
      await store.set(`prospect:${p.id}`, p);
    }
    if (!credit && linkEntity) {
      // A link sign-up for a creator who was never on the list:
      // the credit still counts, with no prospect attached.
      credit = {
        id: crypto.randomUUID(),
        recruiterId: linkEntity.id,
        userId: user.id,
        handle: user.creator.handle,
        market: user.market,
        via: "link",
        prospectId: null,
        at: nowIso(),
      };
      await store.set(`rcredit:${credit.id}`, credit);
      await logEvent({ type: "recruiter_signup_credit", actorId: user.id, actorRole: "creator", subjectId: user.id, market: user.market, data: { recruiterId: linkEntity.id, via: "link", prospectId: null, handle: user.creator.handle } });
    }
    void creditedViaProspect;
  } catch (e) { /* attribution never blocks a sign-up */ }
}

// The approval hook (admin review): a claimed prospect whose
// creator is approved moves to approved. Views also derive this,
// so no approval path can strand a prospect at claimed.
async function onCreatorApproved(user) {
  try {
    if (!user || user.role !== "creator") return;
    const prospects = (await allProspects()).filter((p) => p.linkedUserId === user.id && p.status === "claimed");
    for (const p of prospects) {
      p.status = "approved";
      p.updatedAt = nowIso();
      await store.set(`prospect:${p.id}`, p);
    }
  } catch (e) { /* best-effort */ }
}

// ---------------- rollups ----------------

async function rollupFor(entity, prospects, credits, users) {
  const mine = prospects.filter((p) => p.recruiterId === entity.id || p.recruiterId === seatIdFor(entity.marketId));
  const counts = { to_contact: 0, sent: 0, replied: 0, claimed: 0, approved: 0, not_interested: 0, do_not_contact: 0 };
  const sentByChannel = { instagram: 0, tiktok: 0, email: 0 };
  let sends = 0;
  for (const p of mine) {
    const st = await effectiveStatus(p, users);
    if (counts[st] != null) counts[st] += 1;
    for (const s of p.sends || []) {
      sends += 1;
      if (sentByChannel[s.channel] != null) sentByChannel[s.channel] += 1;
    }
  }
  const myCredits = credits.filter((c) => c.recruiterId === entity.id);
  const approvedUserIds = new Set((users || []).filter((u) => u.status === "approved").map((u) => u.id));
  return {
    recruiter: entityView(entity),
    assigned: mine.length,
    counts,
    sends,
    sentByChannel,
    replies: counts.replied + counts.claimed + counts.approved,
    claimsStarted: myCredits.length,
    signupsApproved: myCredits.filter((c) => approvedUserIds.has(c.userId)).length,
    creditsViaLink: myCredits.filter((c) => c.via === "link").length,
    creditsViaListMatch: myCredits.filter((c) => c.via === "list-match").length,
    conflicts: mine.filter((p) => p.creditConflict).map((p) => ({ prospectId: p.id, handle: p.handle, name: p.name, creditConflict: p.creditConflict })),
  };
}

async function allCredits() {
  const rows = await store.list("rcredit:");
  return rows.map((r) => r.value).filter(Boolean);
}

// ---------------- seeds ----------------
// One-time, claimed-flag guarded imports (the pattern every other
// one-time job in this codebase uses). The seed JSON files are
// built from the researched lists in the goal files by
// scripts/build-recruiter-seeds.mjs; imports are idempotent
// through the dedupe law, so a re-run adds nothing twice.
//
// Build -72 (Jeff, 2026-11-02): two laws changed after the first
// production hang. (1) NO READ EVER BLOCKS ON SEEDING: read paths
// call kickSeeds() fire-and-forget and serve the data already in
// the store; the import drains in the background through normal
// use. The original shape awaited the full ~1,300-record import
// inside GET /admin/recruiters, which on the Blobs-backed store
// ran past the function timeout, so the response never arrived
// and the Admin Recruiters tab rendered nothing. (2) SEEDING IS
// RESUMABLE: each seed file stamps its own done flag the moment
// its import completes, so an invocation killed mid-import loses
// at most the file in flight, and the next pass skips finished
// files. The global flag is set only once every file's flag is
// down. Dubai stays first: Bella's queue lands before anything.

const SEED_FILE_SLUGS = ["dubai", "brain", "austin", "denver", "dallas", "chicago"];
function seedFileFlagKey(slug) { return `config:recruiterSeedFile:${slug}`; }

let seedsRunning = false;
async function ensureSeeds(force) {
  try {
    if (seedsRunning) return null;
    const flag = await store.get(SEED_FLAG_KEY);
    if (flag && !force) return null;
    seedsRunning = true;
    const results = {};
    const owner = await ensureOwnerEntity();

    // Runs one seed file's import, then stamps its per-file done
    // flag. A step that throws leaves its flag unset, so the next
    // invocation resumes with exactly that file.
    async function runStep(slug, resultKey, fn) {
      if (!force) {
        const doneFlag = await store.get(seedFileFlagKey(slug));
        if (doneFlag) { results[resultKey] = "already-imported"; return; }
      }
      results[resultKey] = await fn();
      await store.set(seedFileFlagKey(slug), { at: nowIso() });
    }

    try {
      await runStep("dubai", "dubai", async () => {
        const seed = require("./recruiter-seed-dubai.json");
        const recs = (seed && seed.prospects) || [];
        return importProspects({ marketName: "Dubai", recruiterId: seatIdFor("dubai"), records: recs, source: "dubai-seed-2026-11", actorId: null });
      });
    } catch (e) { results.dubai = { error: String((e && e.message) || e) }; }
    const ownerFiles = [
      ["recruiter-seed-brain.json", null],
      ["recruiter-seed-austin.json", "Austin"],
      ["recruiter-seed-denver.json", "Denver"],
      ["recruiter-seed-dallas.json", "Dallas"],
      ["recruiter-seed-chicago.json", "Chicago"],
    ];
    for (const [file, fixedMarket] of ownerFiles) {
      const slug = file.replace("recruiter-seed-", "").replace(".json", "");
      try {
        await runStep(slug, file, async () => {
          const data = require(`./${file}`);
          const recs = Array.isArray(data) ? data : (data.prospects || []);
          if (fixedMarket) {
            return importProspects({ marketName: fixedMarket, recruiterId: owner.id, records: recs, source: file.replace("recruiter-", "").replace(".json", ""), actorId: null });
          }
          const byMarket = {};
          for (const r of recs) {
            const m = (marketByNameLoose(r.market || "") || {}).name || r.market;
            if (!OWNER_MARKETS.includes(m)) continue;
            (byMarket[m] = byMarket[m] || []).push(r);
          }
          const perMarket = {};
          for (const m of Object.keys(byMarket)) {
            perMarket[m] = await importProspects({ marketName: m, recruiterId: owner.id, records: byMarket[m], source: "brain-store", actorId: null });
          }
          return perMarket;
        });
      } catch (e) { results[file] = { error: String((e && e.message) || e) }; }
    }
    // The global flag means "every file is in"; it is set only
    // when each per-file flag is down, never before.
    let allDone = true;
    for (const slug of SEED_FILE_SLUGS) {
      if (!(await store.get(seedFileFlagKey(slug)))) { allDone = false; break; }
    }
    if (allDone) {
      await store.set(SEED_FLAG_KEY, { at: nowIso(), results });
      await logEvent({ type: "recruiter_seeds_imported", actorId: null, actorRole: "system", subjectId: null, market: null, data: { results: JSON.parse(JSON.stringify(results, (k, v) => (k === "error" ? String(v) : v))) } });
    }
    seedsRunning = false;
    return results;
  } catch (e) {
    seedsRunning = false;
    return null;
  }
}

// Fire-and-forget seed warm-up for read paths (Build -72). The
// in-process seedsRunning guard makes repeat calls cheap no-ops
// while an import is draining, and ensureSeeds never rejects; the
// catch is belt-and-braces so a seeding fault can never break the
// request that happened to trigger it.
function kickSeeds() {
  try {
    const p = ensureSeeds();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) { /* seeding must never break a read */ }
}

// ---------------- staff invite ----------------

async function inviteStaffRecruiter({ name, email, market, actorId, sponsorPartnerId, actorRole }) {
  const cleanName = String(name || "").trim().slice(0, 80);
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanName) return { error: "The recruiter's name is required" };
  if (!isEmail(cleanEmail)) return { error: "A valid email is required" };
  const mkt = marketByNameLoose(market || "");
  if (!mkt) return { error: "Unknown market" };
  if (await store.get(`email:${cleanEmail}`)) return { error: "An account with this email already exists" };
  const entities = await allEntities();
  if (entities.some((e) => e.email === cleanEmail && e.status !== "disabled")) return { error: "That email already holds a recruiter seat" };
  const code = codeFromName(firstNameOf(cleanName), new Set(entities.map((e) => e.code)));
  const ts = nowIso();
  const entity = {
    id: crypto.randomUUID(),
    kind: "staff",
    userId: null,
    name: cleanName,
    email: cleanEmail,
    code,
    marketId: mkt.id,
    marketName: mkt.name,
    markets: [mkt.name],
    status: "active",
    createdAt: ts,
    updatedAt: ts,
    createdBy: actorId || null,
    // Team seats (Build -107): a partner-minted recruiter names
    // its sponsoring partner org; Admin-minted seats omit it.
    ...(sponsorPartnerId ? { sponsorPartnerId } : {}),
  };
  // The login is the app's normal account shape with a random
  // password nobody knows; the recruiter sets her own through the
  // standard password-link email, exactly like the partner flow.
  const tempPassword = crypto.randomBytes(24).toString("hex");
  const { salt, hash } = auth.hashPassword(tempPassword);
  const user = {
    id: crypto.randomUUID(),
    role: "recruiter",
    email: cleanEmail,
    name: cleanName,
    passwordSalt: salt,
    passwordHash: hash,
    status: "approved",
    tester: false,
    market: mkt.name,
    createdAt: ts,
    updatedAt: ts,
    reviewedAt: ts,
    reviewedBy: actorId || null,
    termsVersion: null,
    termsAcceptedAt: ts,
    creator: null,
    business: null,
    recruiterEntityId: entity.id,
    recruiter: { code, marketId: mkt.id, marketName: mkt.name },
  };
  entity.userId = user.id;
  await store.set(`user:${user.id}`, user);
  await store.set(`email:${cleanEmail}`, { userId: user.id });
  await store.set(`recruiter:${entity.id}`, entity);
  // Adopt anything seeded to this market's seat: prospects and
  // credits recorded before the seat had a holder become hers.
  const seat = seatIdFor(mkt.id);
  const prospects = await allProspects();
  for (const p of prospects) {
    if (p.recruiterId === seat) {
      p.recruiterId = entity.id;
      p.updatedAt = ts;
      await store.set(`prospect:${p.id}`, p);
    }
  }
  const credits = await allCredits();
  for (const c of credits) {
    if (c.recruiterId === seat) {
      c.recruiterId = entity.id;
      await store.set(`rcredit:${c.id}`, c);
    }
  }
  let emailSent = false;
  let token = null;
  if (deps.issuePasswordResetToken && deps.passwordResetEmail && deps.deliverEmail) {
    token = await deps.issuePasswordResetToken(user);
    const base = process.env.APP_URL || "https://app.joinsignl.com";
    const mail = deps.passwordResetEmail(user, `${base}/?reset=${token}`);
    const sent = await deps.deliverEmail("password_reset", user, mail.subject, mail.text, null);
    emailSent = !!(sent && sent.sent);
  }
  await logEvent({ type: "staff_recruiter_invited", actorId: actorId || null, actorRole: actorRole || "admin", subjectId: user.id, market: mkt.name, data: { code, email: cleanEmail, marketId: mkt.id, emailSent, ...(sponsorPartnerId ? { sponsorPartnerId } : {}) } });
  return { entity, user, emailSent, token };
}

// ---------------- console API ----------------

function prospectInScope(entity, p) {
  if (!p) return false;
  const assigned = p.recruiterId === entity.id || p.recruiterId === seatIdFor(p.marketId);
  if (!assigned) return false;
  if (entity.kind === "staff") return p.marketId === entity.marketId;
  return (entity.markets || []).includes(p.marketName);
}

function parsePasteList(text) {
  const records = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[,\t;]/).map((s) => s.trim()).filter(Boolean);
    const rec = {};
    const rest = [];
    for (const part of parts) {
      if (isEmail(part) && !rec.email) rec.email = part;
      else if (/instagram\.com\//i.test(part)) { rec.instagramUrl = part; if (!rec.handle) rec.handle = normalizeHandle(part); }
      else if (/tiktok\.com\//i.test(part)) { rec.tiktokUrl = part; if (!rec.handle) rec.handle = normalizeHandle(part); }
      else if (/^@[A-Za-z0-9._-]{2,40}$/.test(part) && !rec.handle) rec.handle = part;
      else if (/^[A-Za-z0-9._-]{2,40}$/.test(part) && !rec.handle && !part.includes(" ")) rec.handle = part;
      else rest.push(part);
    }
    if (rest.length) rec.name = rest[0];
    if (rest.length > 1) rec.category = rest[1];
    if (rec.handle || rec.email || rec.instagramUrl || rec.tiktokUrl) records.push(rec);
  }
  return records;
}

async function handleRecruiterApi({ method, seg, query, event, user }) {
  if (!user) return err(401, "Sign in first");
  const entity = await entityForUser(user);
  if (!entity) return err(403, "This console is for SIGNL recruiters.");
  const sub = seg[1] || "";

  if (method === "GET" && sub === "me") {
    kickSeeds();
    return json(200, { recruiter: entityView(entity) });
  }

  if (method === "GET" && sub === "queue") {
    kickSeeds();
    let marketName = entity.marketName;
    if (entity.kind === "owner" && query && query.market && (entity.markets || []).includes(query.market)) marketName = query.market;
    const users = deps.allUsers ? await deps.allUsers() : [];
    const nowMs = Date.now();
    const mine = (await allProspects()).filter((p) => p.marketName === marketName && prospectInScope(entity, p));
    const views = [];
    for (const p of mine) {
      const v = prospectView(p, users, nowMs);
      v.effectiveStatus = await effectiveStatus(p, users);
      views.push(v);
    }
    const order = { to_contact: 0, sent: 1, replied: 2, claimed: 3, approved: 4, not_interested: 5, do_not_contact: 6 };
    views.sort((a, b) => (order[a.effectiveStatus] - order[b.effectiveStatus]) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const counts = { to_contact: 0, sent: 0, replied: 0, claimed: 0, approved: 0, not_interested: 0, do_not_contact: 0, total: views.length };
    for (const v of views) if (counts[v.effectiveStatus] != null) counts[v.effectiveStatus] += 1;
    return json(200, { market: marketName, counts, prospects: views });
  }

  if (method === "POST" && sub === "prospects" && seg.length === 2) {
    const b = parseBody(event);
    let marketName = entity.marketName;
    if (entity.kind === "owner" && b.market && (entity.markets || []).includes(b.market)) marketName = b.market;
    const result = await importProspects({ marketName, recruiterId: entity.id, records: [b], source: b.source || (entity.kind === "owner" ? "admin-manual" : "recruiter-manual"), actorId: user.id });
    if (result.added === 0 && result.blockedDoNotContact > 0) return err(409, "That creator is on the do-not-contact list and cannot be re-added.");
    if (result.added === 0 && result.skippedDuplicate > 0) return err(409, "That creator is already in this queue.");
    if (result.added === 0) return err(400, "Add a handle or an email for the creator.");
    return json(200, { ok: true, result });
  }

  if (method === "POST" && sub === "prospects" && seg[2] === "import" && seg.length === 3) {
    const b = parseBody(event);
    let marketName = entity.marketName;
    if (entity.kind === "owner" && b.market && (entity.markets || []).includes(b.market)) marketName = b.market;
    const records = Array.isArray(b.records) ? b.records : parsePasteList(b.text || "");
    if (!records.length) return err(400, "Nothing to import. Paste one creator per line: name, @handle, email, category.");
    const result = await importProspects({ marketName, recruiterId: entity.id, records, source: b.source || "paste-import", actorId: user.id });
    await logEvent({ type: "recruiter_prospects_imported", actorId: user.id, actorRole: user.role, subjectId: null, market: marketName, data: { recruiterId: entity.id, result } });
    return json(200, { ok: true, result });
  }

  if (sub === "prospects" && seg[2]) {
    const p = await store.get(`prospect:${seg[2]}`);
    if (!p || !prospectInScope(entity, p)) return err(404, "Prospect not found in your queue");
    if (method === "GET" && seg[3] === "drafts") {
      return json(200, { drafts: draftsFor(entity, p), prospectId: p.id, followupReady: followupReady(p, Date.now()) });
    }
    if (method === "POST" && seg[3] === "drafts" && seg[4] === "regenerate") {
      p.drafts = null;
      p.updatedAt = nowIso();
      await store.set(`prospect:${p.id}`, p);
      return json(200, { drafts: draftsFor(entity, p) });
    }
    if (method === "POST" && seg[3] === "drafts") {
      const b = parseBody(event);
      const d = b.drafts || {};
      const clean = {};
      for (const k of ["ig", "tiktok", "emailSubject", "emailBody", "followup"]) {
        if (typeof d[k] === "string" && d[k].trim()) clean[k] = d[k].slice(0, 4000);
      }
      p.drafts = Object.keys(clean).length ? clean : null;
      p.updatedAt = nowIso();
      await store.set(`prospect:${p.id}`, p);
      return json(200, { drafts: draftsFor(entity, p) });
    }
    if (method === "POST" && seg[3] === "action") {
      const b = parseBody(event);
      const action = String(b.action || "");
      const at = nowIso();
      if (action === "sent") {
        if (p.status !== "to_contact") return err(400, "Only a creator still to contact can be marked sent.");
        const channel = ["instagram", "tiktok", "email"].includes(b.channel) ? b.channel : "instagram";
        p.sends = (p.sends || []).concat([{ channel, at, kind: "first" }]);
        p.firstSentAt = at;
        p.status = "sent";
      } else if (action === "followup-sent") {
        if (!followupReady(p, Date.now())) return err(400, "The follow-up unlocks 4 days after the first send, and only once.");
        const channel = ["instagram", "tiktok", "email"].includes(b.channel) ? b.channel : "instagram";
        p.sends = (p.sends || []).concat([{ channel, at, kind: "followup" }]);
        p.followupSentAt = at;
      } else if (action === "replied") {
        if (p.status !== "sent") return err(400, "Only a contacted creator can be marked replied.");
        p.status = "replied";
        p.repliedAt = at;
      } else if (action === "not_interested") {
        if (["claimed", "approved", "do_not_contact"].includes(p.status)) return err(400, "That status cannot change to not interested.");
        p.status = "not_interested";
      } else if (action === "do_not_contact") {
        if (["claimed", "approved"].includes(p.status)) return err(400, "A signed-up creator cannot be moved to do-not-contact.");
        p.status = "do_not_contact";
      } else if (action === "claimed") {
        if (["approved", "do_not_contact"].includes(p.status)) return err(400, "That status cannot change to claimed.");
        p.status = "claimed";
        p.claimedAt = p.claimedAt || at;
      } else if (action === "reopen") {
        if (p.status !== "not_interested") return err(400, "Only a not-interested creator can be reopened.");
        p.status = "to_contact";
      } else {
        return err(400, "Unknown action");
      }
      p.updatedAt = at;
      await store.set(`prospect:${p.id}`, p);
      await logEvent({ type: `recruiter_prospect_${action.replace(/-/g, "_")}`, actorId: user.id, actorRole: user.role, subjectId: null, market: p.marketName, data: { recruiterId: entity.id, prospectId: p.id, handle: p.handle, channel: b.channel || null } });
      const users = deps.allUsers ? await deps.allUsers() : [];
      const v = prospectView(p, users, Date.now());
      v.effectiveStatus = await effectiveStatus(p, users);
      return json(200, { ok: true, prospect: v });
    }
    return err(404, "Not found");
  }

  if (method === "GET" && sub === "results") {
    const users = deps.allUsers ? await deps.allUsers() : [];
    const prospects = await allProspects();
    const credits = await allCredits();
    const rollup = await rollupFor(entity, prospects, credits, users);
    const usersById = new Map(users.map((u) => [u.id, u]));
    const credited = credits.filter((c) => c.recruiterId === entity.id).map((c) => {
      const u = usersById.get(c.userId);
      return {
        userId: c.userId, handle: c.handle, market: c.market, via: c.via, prospectId: c.prospectId, at: c.at,
        name: u ? u.name : "", status: u ? u.status : "",
      };
    }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return json(200, { rollup, credited });
  }

  return err(404, "Not found");
}

// ---------------- admin API ----------------

async function handleAdminRecruiters({ method, seg, event, user }) {
  if (seg[2] === "seed" && method === "POST") {
    const results = await ensureSeeds(true);
    return json(200, { ok: true, results });
  }
  if (seg.length === 2 && method === "GET") {
    kickSeeds();
    const users = deps.allUsers ? await deps.allUsers() : [];
    const prospects = await allProspects();
    const credits = await allCredits();
    const entities = await allEntities();
    const rollups = [];
    for (const e of entities) rollups.push(await rollupFor(e, prospects, credits, users));
    return json(200, { recruiters: rollups, markets: MARKETS.map((m) => ({ id: m.id, name: m.name })) });
  }
  if (seg[2] === "invite" && method === "POST") {
    // Warm the seed import in the background (Build -72): the
    // invite itself never seeds (it adopts whatever is already
    // assigned to the market's seat), it just keeps the drain
    // moving through normal Admin use.
    kickSeeds();
    const b = parseBody(event);
    const result = await inviteStaffRecruiter({ name: b.name, email: b.email, market: b.market, actorId: user.id });
    if (result.error) return err(400, result.error);
    const out = { ok: true, recruiter: entityView(result.entity), emailSent: result.emailSent };
    if (testModeOn()) out.devResetToken = result.token;
    return json(200, out);
  }
  if (seg[2] && seg[3] === "resend-invite" && method === "POST") {
    const entity = await entityById(seg[2]);
    if (!entity || entity.kind !== "staff" || !entity.userId) return err(404, "Recruiter not found");
    const target = await store.get(`user:${entity.userId}`);
    if (!target) return err(404, "Recruiter account not found");
    let emailSent = false;
    let token = null;
    if (deps.issuePasswordResetToken && deps.passwordResetEmail && deps.deliverEmail) {
      token = await deps.issuePasswordResetToken(target);
      const base = process.env.APP_URL || "https://app.joinsignl.com";
      const mail = deps.passwordResetEmail(target, `${base}/?reset=${token}`);
      const sent = await deps.deliverEmail("password_reset", target, mail.subject, mail.text, null);
      emailSent = !!(sent && sent.sent);
    }
    await logEvent({ type: "staff_recruiter_invite_resent", actorId: user.id, actorRole: "admin", subjectId: target.id, market: entity.marketName, data: { code: entity.code, emailSent } });
    const out = { ok: true, emailSent };
    if (testModeOn()) out.devResetToken = token;
    return json(200, out);
  }
  return err(404, "Not found");
}

// Admin sets a Dubai creator's Advertiser Permit status. It never
// gates sign-up; it tracks the step a creator must finish before
// their first paid or gifted post.
async function handleAdminAdvertiserPermit({ seg, event }) {
  const b = parseBody(event);
  const status = String(b.status || "");
  if (!ADVERTISER_PERMIT_STATUSES.includes(status)) return err(400, "status must be not_started, in_progress or done");
  const target = await store.get(`user:${seg[2]}`);
  if (!target || target.role !== "creator") return err(404, "Creator not found");
  target.advertiserPermit = status;
  target.updatedAt = nowIso();
  await store.set(`user:${target.id}`, target);
  await logEvent({ type: "advertiser_permit_updated", actorId: null, actorRole: "admin", subjectId: target.id, market: target.market, data: { status } });
  return json(200, { ok: true, advertiserPermit: status });
}

module.exports = {
  init,
  allEntities,
  handleRecruiterApi,
  handleAdminRecruiters,
  handleAdminAdvertiserPermit,
  onCreatorRegistered,
  onCreatorApproved,
  ensureSeeds,
  inviteStaffRecruiter,
  buildDrafts,
  draftsFor,
  claimLinkFor,
  importProspects,
  normalizeProspectInput,
  parsePasteList,
  followupReady,
  rollupFor,
  entityView,
  RECRUITER_SRC_PREFIX,
  OWNER_MARKETS,
  DUBAI_PERMIT_LINE,
  ADVERTISER_PERMIT_STATUSES,
  _test: { allEntities, allProspects, allCredits, creditForUser, entityByCode, ensureOwnerEntity, seatIdFor, prospectHandles, effectiveStatus },
};
