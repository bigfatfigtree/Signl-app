// Build the claim auto-decision evidence snapshot (Jeff standing
// authority, 2026-10-22). The auto-decision rules in the router
// approve a non-referred creator claim only when it verifiably
// matches our own outreach records. This script imports those
// records ONCE into a server-side data file the functions bundle
// can read (netlify/functions/lib/claim-evidence-data.json):
//
//   handleEmail[]  Rule A evidence: { handle, email, market,
//                  source } from the campaign email batches and
//                  the creator email harvest. A claim whose handle
//                  AND email both equal an entry matches Rule A.
//   linkSent[]     Rule B evidence: { handle, market, source }
//                  from the campaign email batches (the campaign
//                  email embeds the personal claim link) and the
//                  DM claim sprint records (each entry's claim
//                  link was sent in a warm follow-up DM). A claim
//                  whose handle AND market match an entry was
//                  verifiably sent a personal claim link.
//
// Deliberately NOT imported: the DM send log (state.json). It
// records that a DM was sent but not whether the personal claim
// link was in it (cold first touches carried the generic link),
// and it carries no emails, so it can satisfy neither rule.
//
// Refresh: re-run `node scripts/build-claim-evidence.mjs` after
// new campaign batches or sprint waves are prepared, then commit
// the regenerated JSON with the import files it came from.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const campaignRun = path.join(appRoot, "..", "signl-campaign-run");
const harvestCsv = path.join(appRoot, "..", "goals", "local-creator-platform-max-media-licensing-deal", "files", "signl-creator-email-harvest.csv");
const outPath = path.join(appRoot, "netlify", "functions", "lib", "claim-evidence-data.json");

const normHandle = (h) => String(h || "").replace(/^@/, "").trim().toLowerCase();
const normEmail = (e) => String(e || "").trim().toLowerCase();
const normMarket = (m) => String(m || "").trim();

const handleEmail = new Map(); // key handle|email
const linkSent = new Map(); // key handle|market
const sourceCounts = {};

function addBatch(list, source) {
  let n = 0;
  for (const r of list || []) {
    const handle = normHandle(r.handle);
    const email = normEmail(r.email);
    const market = normMarket(r.market);
    if (!handle || !email || !market) continue;
    handleEmail.set(`${handle}|${email}`, { handle, email, market, source });
    linkSent.set(`${handle}|${market}`, { handle, market, source });
    n += 1;
  }
  sourceCounts[source] = (sourceCounts[source] || 0) + n;
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Campaign email batches (import files for the in-app campaign;
// every campaign email embeds the recipient's personal claim
// link, so a batch entry is both Rule A and Rule B evidence).
for (const f of ["batch2-import.json", "batch2-now.json", "batch2-tomorrow.json", "batch2-tonight.json", "batch2-tue-evening-import.json", "batch2b-import.json"]) {
  addBatch(readJson(path.join(campaignRun, f)), `campaign_batch:${f}`);
}
// Claim sprint email wave (same claim-link mechanic by email).
addBatch(readJson(path.join(campaignRun, "claim-sprint", "wave1-email.json")), "claim_sprint_email");

// Creator email harvest: rows are sendable evidence only when
// they carry a handle, an email, and the source page the address
// was seen on (the harvest's own evidence rule).
{
  const text = fs.readFileSync(harvestCsv, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(",").map((s) => s.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  // Minimal CSV parse: the harvest uses quoted fields with
  // embedded commas, so split respecting quotes.
  const parseRow = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  let n = 0;
  for (const line of lines.slice(1)) {
    const cols = parseRow(line);
    const handle = normHandle(cols[idx.handle]);
    const email = normEmail(cols[idx.email]);
    const market = normMarket(cols[idx.city]);
    const sourceUrl = String(cols[idx.source_url] || "").trim();
    if (!handle || !email || !market || !sourceUrl) continue;
    const key = `${handle}|${email}`;
    if (!handleEmail.has(key)) handleEmail.set(key, { handle, email, market, source: "email_harvest" });
    n += 1;
  }
  sourceCounts.email_harvest = n;
}

// DM claim sprint records: each entry in wave1-dm.md carries the
// personal claim link that the Tue 2026-10-20 sprint run sent in
// the warm follow-up DM. Parse the claim links themselves, so the
// evidence is exactly handle + market as sent.
{
  const md = fs.readFileSync(path.join(campaignRun, "claim-sprint", "wave1-dm.md"), "utf8");
  const re = /app\.joinsignl\.com\/\?handle=([^&\s]+)&market=([^&\s]+)/g;
  let m;
  let n = 0;
  while ((m = re.exec(md)) !== null) {
    const handle = normHandle(decodeURIComponent(m[1]));
    const market = normMarket(decodeURIComponent(m[2]));
    if (!handle || !market) continue;
    const key = `${handle}|${market}`;
    if (!linkSent.has(key)) linkSent.set(key, { handle, market, source: "dm_claim_sprint" });
    n += 1;
  }
  sourceCounts.dm_claim_sprint = n;
}

const snapshot = {
  _meta: {
    generatedAt: new Date().toISOString(),
    refresh: "node scripts/build-claim-evidence.mjs (re-run after new campaign batches or sprint waves; commit the regenerated file)",
    sources: sourceCounts,
    excluded: "signl-campaign-run/state.json DM send log: proves a DM was sent, not that the personal claim link was in it, and carries no emails; satisfies neither rule.",
  },
  handleEmail: [...handleEmail.values()].sort((a, b) => (a.handle < b.handle ? -1 : 1)),
  linkSent: [...linkSent.values()].sort((a, b) => (a.handle < b.handle ? -1 : 1)),
};

fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 1) + "\n");
console.log(`claim evidence snapshot written: ${snapshot.handleEmail.length} handle+email entries, ${snapshot.linkSent.length} claim-link entries`);
console.log("sources:", JSON.stringify(sourceCounts));
const zay = snapshot.linkSent.find((e) => e.handle === "mr.5starzay");
console.log("mr.5starzay linkSent entry:", JSON.stringify(zay || null));
