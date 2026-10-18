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

async function listEvents({ limit = 500 } = {}) {
  const rows = await store.list("event:");
  const events = rows.map((r) => r.value);
  events.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // newest first
  return events.slice(0, limit);
}

module.exports = { logEvent, listEvents };
