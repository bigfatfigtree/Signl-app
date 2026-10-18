// Storage layer for SIGNL.
// Production: Netlify Blobs (store name "signl-data"), key-per-record.
// Local dev / verification: a single JSON file on disk, selected when
// SIGNL_LOCAL=1. The rest of the app only sees this interface:
//   get(key) -> object|null
//   set(key, object)
//   del(key)
//   list(prefix) -> [{ key, value }] sorted by key
//
// Record key conventions:
//   user:{uuid}                  account + profile/business payload
//   email:{lowercased email}     { userId } uniqueness index
//   session:{token}              { userId, createdAt, expiresAt }
//   offer:{uuid}                 comp offer
//   booking:{uuid}               booking + redemption credential state
//   code:{SGNL-XXXXXX}          { bookingId } redemption lookup index
//   post:{uuid}                  submitted post record
//   message:{uuid}               message (threadId = sorted pair of user ids)
//   favorite:{businessId}:{creatorId}  { createdAt }
//   event:{yyyy-mm-dd}:{uuid}    append-only event log record
//   photo:{userId}               creator profile photo { contentType, dataBase64, bytes, uploadedAt }
//   config:markets               { flags: { [marketName]: true } } market activation; absent = not live

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
};

let blobsStore = null;
function getBlobs() {
  if (!blobsStore) {
    const { getStore } = require("@netlify/blobs");
    blobsStore = getStore({ name: "signl-data", consistency: "strong" });
  }
  return blobsStore;
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
  async list(prefix) {
    const store = getBlobs();
    const out = [];
    let cursor;
    do {
      const page = await store.list({ prefix, cursor });
      for (const blob of page.blobs) {
        const value = await store.get(blob.key, { type: "json" });
        if (value !== null && value !== undefined) out.push({ key: blob.key, value });
      }
      cursor = page.cursor;
    } while (cursor);
    out.sort((a, b) => (a.key < b.key ? -1 : 1));
    return out;
  },
};

module.exports = LOCAL ? fileStore : blobsAdapter;
module.exports.isLocal = LOCAL;
