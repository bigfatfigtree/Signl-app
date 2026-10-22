// Claim auto-decision evidence (internal only; Jeff standing
// authority, 2026-10-22). The router may decide a creator claim
// without a person only when the claim verifiably matches our own
// outreach records:
//
//   Rule A: the claim handle AND the claim email both equal an
//     evidenced outreach record (campaign email batches, the
//     creator email harvest, plus live checks the router runs
//     against campaign recipients it has actually sent and prior
//     approvals).
//   Rule B: a personal claim link was verifiably sent to that
//     exact handle for that exact market (campaign email batches,
//     whose emails embed the link, and the DM claim sprint
//     records), and the claim's handle + market match the link's.
//
// The static half of that evidence lives in
// claim-evidence-data.json, a one-time snapshot imported from the
// campaign-run workspace by scripts/build-claim-evidence.mjs
// (re-run it to refresh; see the _meta block in the JSON). This
// module only indexes the snapshot; the live half (campaign
// recipient records, prior approvals) is checked by the router at
// decision time. Nothing in here is ever exposed to a client: the
// snapshot contains outreach addresses we already hold, and it
// stays on the server side of the functions bundle.

let snapshot = { handleEmail: [], linkSent: [] };
try {
  snapshot = require("./claim-evidence-data.json");
} catch (e) {
  // A missing snapshot means no static evidence: every claim
  // falls back to manual review (and the live checks still run).
  snapshot = { handleEmail: [], linkSent: [] };
}

const byHandleEmail = new Map();
for (const e of snapshot.handleEmail || []) {
  if (e && e.handle && e.email) byHandleEmail.set(`${e.handle}|${e.email}`, e);
}
const linkByHandleMarket = new Map();
for (const e of snapshot.linkSent || []) {
  if (e && e.handle && e.market) linkByHandleMarket.set(`${e.handle}|${e.market}`, e);
}

function normHandle(h) {
  return String(h || "").replace(/^@/, "").trim().toLowerCase();
}

// Snapshot Rule A: an entry whose handle and email both match.
function snapshotMatchA(handle, email) {
  const e = byHandleEmail.get(`${normHandle(handle)}|${String(email || "").trim().toLowerCase()}`);
  return e ? e.source || "snapshot" : null;
}

// Snapshot Rule B: an entry whose handle and market both match.
function snapshotMatchB(handle, market) {
  const e = linkByHandleMarket.get(`${normHandle(handle)}|${String(market || "").trim()}`);
  return e ? e.source || "snapshot" : null;
}

module.exports = { snapshotMatchA, snapshotMatchB, counts: { handleEmail: byHandleEmail.size, linkSent: linkByHandleMarket.size } };
