// Storage layer for SIGNL.
// Production: Netlify Blobs (store name "signl-data"), key-per-record.
// Local dev / verification: a single JSON file on disk, selected when
// SIGNL_LOCAL=1. The rest of the app only sees this interface:
//   get(key) -> object|null
//   set(key, object)
//   del(key)
//   list(prefix) -> [{ key, value }] sorted by key
//   listKeys(prefix) -> [key] sorted, WITHOUT fetching values
//   getMany(keys) -> [{ key, value }] sorted by key, values fetched
//     with bounded concurrency (never one serial round trip per key)
//
// Record key conventions:
//   user:{uuid}                  account + profile/business payload
//   email:{lowercased email}     { userId } uniqueness index
//   session:{token}              { userId, createdAt, expiresAt }
//   pwreset:{sha256 of token}    { userId, email, createdAt, expiresAt } password reset, hash only at rest
//   pwreset-user:{userId}        { tokenHash, createdAt } latest reset token per account
//   offer:{uuid}                 comp offer
//   booking:{uuid}               booking + redemption credential state
//   code:{SGNL-XXXXXX}          { bookingId } redemption lookup index
//   post:{uuid}                  submitted post record
//   message:{uuid}               message (threadId = sorted pair of user ids)
//   favorite:{businessId}:{creatorId}  { createdAt }
//   event:{yyyy-mm-dd}:{uuid}    append-only event log record
//   photo:{userId}               creator profile photo { contentType, dataBase64, bytes, uploadedAt }
//   config:markets               { flags: { [marketName]: true } } market activation; absent = not live
//   campaign:{id}                outreach campaign config { armed, lastError, lastRunAt, totalSent, ... }
//   campaign-recipient:{id}:{email}  one queued/sent/skipped outreach recipient

const fs = require("fs");
const path = require("path");

const LOCAL = process.env.SIGNL_LOCAL === "1";
const DB_PATH =
  process.env.SIGNL_LOCAL_DB ||
  path.join(__dirname, "..", "..", "..", ".localdb.json");

let fileCache = null;

function loadFile() {
  if (fileCache) return fileCache;
  try {
    fileCache = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (e) {
    fileCache = {};
  }
  return fileCache;
}

function saveFile() {
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(fileCache));
  fs.renameSync(tmp, DB_PATH);
}

const fileStore = {
  async get(key) {
    const db = loadFile();
    return Object.prototype.hasOwnProperty.call(db, key) ? db[key] : null;
  },
  async set(key, value) {
    const db = loadFile();
    db[key] = value;
    saveFile();
  },
  async del(key) {
    const db = loadFile();
    delete db[key];
    saveFile();
  },
  async list(prefix) {
    const db = loadFile();
    return Object.keys(db)
      .filter((k) => k.startsWith(prefix))
      .sort()
      .map((k) => ({ key: k, value: db[k] }));
  },
  async listKeys(prefix) {
    const db = loadFile();
    return Object.keys(db).filter((k) => k.startsWith(prefix)).sort();
  },
  async getMany(keys) {
    const db = loadFile();
    return keys
      .filter((k) => Object.prototype.hasOwnProperty.call(db, k))
      .sort()
      .map((k) => ({ key: k, value: db[k] }));
  },
};

let blobsStore = null;
function getBlobs() {
  if (!blobsStore) {
    const { getStore } = require("@netlify/blobs");
    const opts = { name: "signl-data", consistency: "strong" };
    // Manual configuration path: this site's function runtime does not
    // receive the automatic Blobs environment, so when the explicit
    // credentials are present in env, use them.
    if (process.env.NETLIFY_BLOBS_SITE_ID && process.env.NETLIFY_BLOBS_TOKEN) {
      opts.siteID = process.env.NETLIFY_BLOBS_SITE_ID;
      opts.token = process.env.NETLIFY_BLOBS_TOKEN;
    }
    blobsStore = getStore(opts);
  }
  return blobsStore;
}

// Fetch values for a list of keys with bounded concurrency. The
// previous list() awaited one Blobs get per key, strictly serially:
// cost grew linearly with record count until admin reads over the
// big prefixes (event:, campaign-recipient:) blew the function
// timeout and the Admin Events / Campaign tabs hung on "Loading..."
// forever (2026-10-25 follow-up to INCIDENT-2026-10-25). Same
// contract as before (sorted by key, vanished keys skipped), just
// parallel.
const VALUE_FETCH_CONCURRENCY = 12;
async function fetchValues(keys) {
  const store = getBlobs();
  const rows = new Array(keys.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < keys.length) {
      const i = next;
      next += 1;
      const value = await store.get(keys[i], { type: "json" });
      if (value !== null && value !== undefined) rows[i] = { key: keys[i], value };
    }
  }
  const workers = Math.min(VALUE_FETCH_CONCURRENCY, keys.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return rows.filter(Boolean);
}

const blobsAdapter = {
  async get(key) {
    return await getBlobs().get(key, { type: "json" });
  },
  async set(key, value) {
    await getBlobs().setJSON(key, value);
  },
  async del(key) {
    await getBlobs().delete(key);
  },
  async listKeys(prefix) {
    const store = getBlobs();
    const keys = [];
    let cursor;
    do {
      const page = await store.list({ prefix, cursor });
      for (const blob of page.blobs) keys.push(blob.key);
      cursor = page.cursor;
    } while (cursor);
    keys.sort();
    return keys;
  },
  async getMany(keys) {
    const rows = await fetchValues([...keys].sort());
    rows.sort((a, b) => (a.key < b.key ? -1 : 1));
    return rows;
  },
  async list(prefix) {
    const keys = await blobsAdapter.listKeys(prefix);
    return await blobsAdapter.getMany(keys);
  },
};

module.exports = LOCAL ? fileStore : blobsAdapter;
module.exports.isLocal = LOCAL;
