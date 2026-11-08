// Build -150 measurement: how many individual store value
// fetches does ONE GET /api/admin/stats/data perform? In
// production every value fetch is a separate Netlify Blobs GET
// (12-way concurrency), so fetch count is the honest proxy for
// the wall clock that killed Jeff's load. Runs the real handler
// in-process against (A) the post-import repro store and (B) the
// same store plus a realistic pre-existing event log (~12k
// everyday events, Oct 18 - Nov 6).
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const srcDir = process.argv[2];
if (!srcDir) { console.error("usage: qa-count-data150.mjs <reproDbDir>"); process.exit(2); }

async function runVariant(label, dbPath) {
  // Fresh module registry per variant.
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  process.env.SIGNL_LOCAL = "1";
  process.env.SIGNL_LOCAL_DB = dbPath;
  process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
  process.env.ADMIN_PASSWORD = "count-admin-pass";
  const store = require("../netlify/functions/lib/store.js");
  const counts = { get: 0, getManyKeys: 0, listKeysScanned: 0, listValues: 0, listOps: 0 };
  const origGet = store.get.bind(store);
  const origGetMany = store.getMany.bind(store);
  const origList = store.list.bind(store);
  const origListKeys = store.listKeys.bind(store);
  store.get = async (k) => { counts.get += 1; return origGet(k); };
  store.getMany = async (ks) => { counts.getManyKeys += ks.length; return origGetMany(ks); };
  store.list = async (p) => { counts.listOps += 1; const rows = await origList(p); counts.listValues += rows.length; return rows; };
  store.listKeys = async (p) => { counts.listOps += 1; const ks = await origListKeys(p); counts.listKeysScanned += ks.length; return ks; };
  const { handler } = require("../netlify/functions/api.js");
  const event = {
    httpMethod: "GET",
    path: "/api/admin/stats/data",
    headers: { cookie: "signl_session=count-token" },
    queryStringParameters: { days: "30" },
    body: null,
    isBase64Encoded: false,
  };
  const t0 = Date.now();
  const out = await handler(event);
  const fetches = counts.get + counts.getManyKeys + counts.listValues;
  console.log(`\n== ${label} ==`);
  console.log("status:", out.statusCode, "| local wall:", Date.now() - t0, "ms");
  console.log("value fetches: get", counts.get, "+ getMany keys", counts.getManyKeys, "+ list values", counts.listValues, "=", fetches);
  console.log("list ops:", counts.listOps, "| keys scanned by list/listKeys:", counts.listKeysScanned);
  console.log("blobs-equivalent time @20ms/fetch, 12-way concurrency: ~" + Math.round((fetches * 20) / 12 / 100) / 10 + "s (per-fetch 10-40ms in practice)");
  return { status: out.statusCode, fetches };
}

function prepareDb(withHistory) {
  const dir = fs.mkdtempSync("/tmp/signl-count150-");
  const dbPath = path.join(dir, "db.json");
  const db = JSON.parse(fs.readFileSync(path.join(srcDir, "db.json"), "utf8"));
  db["user:admin1"] = { id: "admin1", role: "admin", email: "jeff@joinsignl.com", name: "Jeff Rimmer", status: "approved", createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z" };
  db["email:jeff@joinsignl.com"] = { userId: "admin1" };
  db["session:count-token"] = { userId: "admin1", createdAt: "2026-11-08T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" };
  if (withHistory) {
    const types = ["user_signed_in", "recruiter_kit_email_sent", "recruiter_kit_email_queued", "post_performance_requested", "post_performance_email_sent", "roster_drop", "notification_sent", "offer_viewed", "profile_backfill_completed", "auto_decision_cleanup_completed"];
    let n = 0;
    for (let day = 0; day < 20; day++) {
      const d = new Date(Date.UTC(2026, 9, 18 + day)).toISOString().slice(0, 10);
      for (let i = 0; i < 600; i++) {
        const id = crypto.randomUUID();
        db[`event:${d}:${id}`] = { id, ts: `${d}T12:00:00.000Z`, type: types[(day + i) % types.length], actorId: "seed", actorRole: "system", subjectId: null, market: null, data: {} };
        n += 1;
      }
    }
    console.log("synthetic history events added:", n);
  }
  fs.writeFileSync(dbPath, JSON.stringify(db));
  console.log("db keys:", Object.keys(db).length, "->", dbPath);
  return dbPath;
}

const a = await runVariant("A: post-import store (1,360 events, outside tables in)", prepareDb(false));
const b = await runVariant("B: A + realistic Oct-Nov event log (~13.4k events)", prepareDb(true));
console.log("\nsummary: A fetches", a.fetches, "| B fetches", b.fetches);
