// Template Studio override layer (Build -138, Admin Expansion
// Area 6).
//
// Templates in this product are code functions, not stored text.
// This module is the stored OVERRIDE layer the builders consult:
// if an override exists for a refId, its free text is what sends;
// the structure (links, booking data, locked lines) stays in code
// and can never be edited away — see requiredTokens below.
//
// Record: template:{refId} ->
//   { refId,
//     kind: "automation_email" | "automation_sms" | "marketing" |
//           "social" | "platform_message",
//     displayName, editLevel, requiredTokens: [...],
//     versions: [{ v, subject, text, editedBy, editedAt, note }],
//     currentVersion, archivedVersions,
//     createdBy, createdAt, updatedAt, updatedBy }
//
// Versions cap at 25. When a save would push past the cap, the
// OLDEST non-current versions are dropped and the count of dropped
// versions is kept on the record as `archivedVersions` — history is
// summarized, never silently deleted (Area 6).
//
// Overrides are read through a 60-second in-memory cache per refId
// (per function instance), invalidated on save / rollback / create,
// so the send funnel pays no extra store read per send in practice.
const store = require("./store");

const VERSION_CAP = 25;
const CACHE_TTL_MS = 60 * 1000;

// refId -> { value: { subject, text, v } | null, expiresAt }
const cache = new Map();

function invalidate(refId) {
  if (refId) cache.delete(refId);
  else cache.clear();
}

function keyFor(refId) {
  return `template:${refId}`;
}

async function getRecord(refId) {
  if (!refId) return null;
  const rec = await store.get(keyFor(refId));
  return rec || null;
}

async function listRecords() {
  const rows = await store.list("template:");
  const records = rows.map((r) => r.value).filter(Boolean);
  records.sort((a, b) => (a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0));
  return records;
}

// The wording that would send today for this refId, or null when no
// override exists (the code builder's own wording sends). Only a
// record whose currentVersion points at a real version counts.
async function currentOverride(refId) {
  if (!refId) return null;
  const now = Date.now();
  const hit = cache.get(refId);
  if (hit && hit.expiresAt > now) return hit.value;
  let value = null;
  const rec = await getRecord(refId);
  if (rec && typeof rec.currentVersion === "number" && rec.currentVersion >= 1 && Array.isArray(rec.versions)) {
    const ver = rec.versions.find((v) => v && v.v === rec.currentVersion);
    if (ver) value = { subject: ver.subject != null ? ver.subject : null, text: ver.text != null ? ver.text : "", v: ver.v };
  }
  cache.set(refId, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

// A saved version may never drop a structural piece. requiredTokens
// names the {token} pieces that must survive in the text (the claim
// link, the unsubscribe line, a first-name greeting). The refusal
// names the missing piece in plain words, per the Area 6 rule.
function assertRequiredTokens(requiredTokens, text) {
  for (const token of requiredTokens || []) {
    if (!token) continue;
    if (!String(text || "").includes(`{${token}}`)) {
      throw new Error(`This template needs the {${token}} piece — add it back before saving.`);
    }
  }
}

// Drop oldest non-current versions until the cap holds. The current
// version is never dropped: it is the wording that sends.
function enforceVersionCap(rec) {
  if (!Array.isArray(rec.versions)) rec.versions = [];
  if (typeof rec.archivedVersions !== "number" || rec.archivedVersions < 0) rec.archivedVersions = 0;
  while (rec.versions.length > VERSION_CAP) {
    const idx = rec.versions.findIndex((v) => v && v.v !== rec.currentVersion);
    if (idx === -1) break; // every stored version is current — cannot happen, but never loop forever
    rec.versions.splice(idx, 1);
    rec.archivedVersions += 1;
  }
}

// Save a new version of a template. If no record exists yet, one is
// created from `meta` ({ kind, displayName, editLevel,
// requiredTokens, createdBy }) — that is how a catalogue template
// gets its first override. Automation records come from the
// catalogue; marketing / social / platform_message records are
// born through createTemplate below instead.
async function saveVersion(refId, { subject, text, editedBy, note, meta } = {}) {
  if (!refId) throw new Error("This template has no name to save under.");
  const bodyText = text != null ? String(text) : "";
  let rec = await getRecord(refId);
  if (!rec) {
    if (!meta || !meta.kind) {
      throw new Error("This template is not in the catalogue yet — it cannot be saved.");
    }
    const now = new Date().toISOString();
    rec = {
      refId,
      kind: meta.kind,
      displayName: meta.displayName || refId,
      editLevel: meta.editLevel || "full",
      requiredTokens: Array.isArray(meta.requiredTokens) ? [...meta.requiredTokens] : [],
      versions: [],
      currentVersion: 0,
      archivedVersions: 0,
      createdBy: meta.createdBy || editedBy || null,
      createdAt: now,
      updatedAt: now,
      updatedBy: editedBy || null,
    };
  }
  // Validate against the record's own list once it exists (the
  // record is the truth), and against meta's list on first save.
  assertRequiredTokens(rec.requiredTokens, bodyText);

  const existing = Array.isArray(rec.versions) ? rec.versions : [];
  const nextV = existing.reduce((max, v) => Math.max(max, (v && v.v) || 0), 0) + 1;
  const now = new Date().toISOString();
  existing.push({
    v: nextV,
    subject: subject != null ? String(subject) : null,
    text: bodyText,
    editedBy: editedBy || null,
    editedAt: now,
    note: note != null ? String(note) : null,
  });
  rec.versions = existing;
  rec.currentVersion = nextV;
  rec.updatedAt = now;
  rec.updatedBy = editedBy || null;
  enforceVersionCap(rec);
  await store.set(keyFor(refId), rec);
  invalidate(refId);
  return rec;
}

// Rollback only moves the pointer: the version it points at becomes
// the wording that sends again. No version entry is appended (a
// rollback is stamped on the record, and the router writes the
// template_rolled_back event) — history itself is never rewritten.
async function rollback(refId, toVersion, by) {
  const rec = await getRecord(refId);
  if (!rec) throw new Error("This template does not exist yet — there is nothing to roll back.");
  const target = Number(toVersion);
  const exists = Array.isArray(rec.versions) && rec.versions.some((v) => v && v.v === target);
  if (!exists) throw new Error("That version is no longer in the history — it may have been archived.");
  rec.currentVersion = target;
  rec.updatedAt = new Date().toISOString();
  rec.updatedBy = by || null;
  await store.set(keyFor(refId), rec);
  invalidate(refId);
  return rec;
}

const CREATABLE_KINDS = {
  // Every marketing send carries the unsubscribe line; it is a
  // required token so no saved version can strip it.
  marketing: { requiredTokens: ["unsubscribeLine"] },
  social: { requiredTokens: [] },
  platform_message: { requiredTokens: [] },
};

// Create a brand-new template of a kind that has no fixed trigger:
// marketing starters, social caption formats, and platform-message
// templates. Automation templates are REFUSED here — they can only
// exist where a trigger already exists in the catalogue (Area 6:
// creating a new automation trigger is a build, not a studio act).
async function createTemplate({ refId, kind, displayName, subject, text, createdBy } = {}) {
  if (!refId) throw new Error("This template has no name to save under.");
  const spec = CREATABLE_KINDS[kind];
  if (!spec) {
    if (kind === "automation_email" || kind === "automation_sms") {
      throw new Error("New automatic emails and texts cannot be created here — they need a trigger in the app first. Marketing, social, and platform-message templates can be created.");
    }
    throw new Error("That kind of template cannot be created here.");
  }
  const existing = await getRecord(refId);
  if (existing) throw new Error("A template with that name already exists — open it and save a new version instead.");
  return saveVersion(refId, {
    subject,
    text,
    editedBy: createdBy || null,
    note: "Created",
    meta: {
      kind,
      displayName: displayName || refId,
      editLevel: "full",
      requiredTokens: [...spec.requiredTokens],
      createdBy: createdBy || null,
    },
  });
}

// Replace {token} pieces from a values object. Unknown tokens are
// left exactly as written: a preview must show an unresolved piece,
// never silently swallow it.
function substitute(text, values) {
  if (text == null) return "";
  const vals = values || {};
  return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, (match, token) => {
    if (Object.prototype.hasOwnProperty.call(vals, token)) {
      const v = vals[token];
      return v == null ? "" : String(v);
    }
    return match;
  });
}

// The Automations room's off switches live in one record,
// config:automations -> { disabled: { [entryId]: true }, updatedBy,
// updatedAt }. The send funnel (router deliverEmail + the notify
// rail) reads the disabled set through here so both funnels agree,
// cached ~30s per instance; the toggle route calls invalidate()
// (no refId) after writing, which clears this cache too.
let disabledCache = { set: null, expiresAt: 0 };
const DISABLED_TTL_MS = 30 * 1000;

async function disabledEntryIds() {
  const now = Date.now();
  if (disabledCache.set && disabledCache.expiresAt > now) return disabledCache.set;
  let set = new Set();
  try {
    const rec = await store.get("config:automations");
    if (rec && rec.disabled && typeof rec.disabled === "object") {
      set = new Set(Object.keys(rec.disabled).filter((k) => rec.disabled[k]));
    }
  } catch (e) { /* a store hiccup must never break the funnel: everything reads as on */ }
  disabledCache = { set, expiresAt: now + DISABLED_TTL_MS };
  return set;
}

const baseInvalidate = invalidate;
invalidate = function (refId) {
  baseInvalidate(refId);
  if (!refId) disabledCache = { set: null, expiresAt: 0 };
};

module.exports = {
  getRecord,
  listRecords,
  currentOverride,
  saveVersion,
  rollback,
  createTemplate,
  substitute,
  invalidate,
  disabledEntryIds,
};
