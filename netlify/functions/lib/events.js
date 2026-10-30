// Append-only event log. This is the founder's core directive: the
// dataset is the asset, so every state change in the product writes
// one event with a timestamp and enough context (market, category,
// tier, plan, timing deltas) to compute benchmarks later.
//
// Event record shape:
//   { id, ts, type, actorId, actorRole, subjectId, market, data }
// Keys: event:{yyyy-mm-dd}:{uuid} so a day's events list by prefix.
const crypto = require("crypto");
const store = require("./store");

async function logEvent({ type, actorId = null, actorRole = null, subjectId = null, market = null, data = {} }) {
  const ts = new Date().toISOString();
  const id = crypto.randomUUID();
  const record = { id, ts, type, actorId, actorRole, subjectId, market, data };
  await store.set(`event:${ts.slice(0, 10)}:${id}`, record);
  return record;
}

// Hard bound on how many event records one read may fetch. The log
// is append-only and grows forever; the old implementation fetched
// EVERY record's value (serially, via store.list) and applied the
// limit only after the fact, so the Admin Events tab's cost grew
// with the whole history of the product until it exceeded the
// function timeout and hung on "Loading..." (2026-10-25). Keys are
// event:{yyyy-mm-dd}:{uuid}, sorted ascending by key, so the newest
// records are the TAIL of the key list: list keys only (cheap),
// fetch values for at most MAX_EVENT_FETCH of the newest keys.
const MAX_EVENT_FETCH = 1000;

async function listEvents({ limit = 500 } = {}) {
  const cap = Math.max(1, Math.min(MAX_EVENT_FETCH, parseInt(limit, 10) || 500));
  const keys = await store.listKeys("event:");
  const rows = await store.getMany(keys.slice(-cap));
  const events = rows.map((r) => r.value).filter((e) => e && typeof e.ts === "string");
  events.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // newest first
  return events.slice(0, cap);
}

// Subject-scoped read (Command Center spec §6.7, Build -54): one
// record's own trail — every event where the record is the subject
// (things done to it) or the actor (things it did) — newest first.
// The general read above caps at the newest 1,000 events, which
// silently drops a long-lived record's early history; this read
// instead walks the key list newest → oldest in bounded chunks and
// keeps scanning until it has the requested matches or the scan
// cap is reached. The result reports how many events were scanned
// and whether the scan stopped early, so a truncated trail is
// labeled, never silent.
const SUBJECT_SCAN_CAP = 5000;
const SUBJECT_CHUNK = 500;

async function listEventsForSubject(subjectId, { limit = 100 } = {}) {
  const want = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
  const keys = await store.listKeys("event:");
  const matches = [];
  let scanned = 0;
  let truncated = false;
  for (let end = keys.length; end > 0 && matches.length < want; end -= SUBJECT_CHUNK) {
    if (scanned >= SUBJECT_SCAN_CAP) { truncated = true; break; }
    const start = Math.max(0, end - SUBJECT_CHUNK);
    const chunkKeys = keys.slice(start, end).slice(-(SUBJECT_SCAN_CAP - scanned));
    const rows = await store.getMany(chunkKeys);
    scanned += chunkKeys.length;
    const events = rows.map((r) => r.value).filter((e) => e && typeof e.ts === "string");
    events.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // newest first within the chunk
    for (const e of events) {
      if (e.subjectId === subjectId || e.actorId === subjectId) {
        matches.push({ ...e, matchedOn: e.subjectId === subjectId ? "subject" : "actor" });
        if (matches.length >= want) break;
      }
    }
    if (start === 0) break;
  }
  // Truncated means the scan did not cover the whole log (scan cap
  // hit, or the match limit stopped the walk early): older matches
  // may exist beyond what was read.
  if (keys.length - scanned > 0) truncated = true;
  matches.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return { events: matches.slice(0, want), scanned, truncated };
}

module.exports = { logEvent, listEvents, listEventsForSubject };
