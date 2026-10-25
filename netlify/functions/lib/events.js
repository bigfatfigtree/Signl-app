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

module.exports = { logEvent, listEvents };
