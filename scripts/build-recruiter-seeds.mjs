// Build the bundled recruiter seed JSONs from the researched
// lists (goal files + brain store). Run at build time; the app
// imports the outputs once, claimed-flag guarded, at runtime.
const fs = require("fs");
const path = require("path");
const GOAL = "/home/hatch/workspace/goals/local-creator-platform-max-media-licensing-deal/files";
const OUT = "/home/hatch/workspace/b70-staging/seeds";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
function writeResilient(file, content) {
  for (let i = 1; i <= 300; i++) {
    try {
      fs.writeFileSync(file, content);
      if (fs.statSync(file).size === Buffer.byteLength(content)) { console.log("WROTE", path.basename(file), Buffer.byteLength(content)); return; }
    } catch (e) {}
    sleep(2000);
  }
  throw new Error("could not write " + file);
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

// Dubai / Denver / Dallas / Chicago ship as researched.
for (const name of ["dubai", "denver", "dallas", "chicago"]) {
  const src = path.join(GOAL, `signl-${name}-prospect-seed-2026-11-02.json`);
  writeResilient(path.join(OUT, `recruiter-seed-${name}.json`), fs.readFileSync(src, "utf8"));
}

// Brain store extract: Jeff's brain markets only, and only the
// states that belong in a working queue (held / failed / tester /
// non-individual records stay out; permanent_fail and declined
// ride along as do_not_contact / not_interested so nobody
// re-contacts them).
const brain = readJson("/home/hatch/workspace/signl-brain/store/prospects.json");
const KEEP = new Set(["untouched", "dm_sent", "emailed", "replied", "claimed", "approved", "declined", "permanent_fail"]);
const MARKETS = new Set(["Austin", "Nashville", "Richmond", "Virginia Beach"]);
const extract = [];
for (const p of brain.prospects || []) {
  if (!MARKETS.has(p.market)) continue;
  if (!KEEP.has(p.contact_state)) continue;
  extract.push({
    name: p.name || "",
    handle: p.handle || "",
    market: p.market,
    category: p.category || "",
    followers: typeof p.followers === "number" ? p.followers : null,
    email: p.email || null,
    emailSource: p.email_evidence || "",
    city: p.city_base || "",
    contact_state: p.contact_state,
    source: "brain-store",
  });
}
writeResilient(path.join(OUT, "recruiter-seed-brain.json"), JSON.stringify(extract));
const byMarket = {};
for (const r of extract) byMarket[r.market] = (byMarket[r.market] || 0) + 1;
console.log("brain extract:", extract.length, JSON.stringify(byMarket));

// Austin email pool (58 evidenced addresses Jeff already emailed
// on 2026-11-01): they queue as already-sent, never as fresh.
const pool = readJson("/home/hatch/workspace/signl-campaign-run/austin-email-pool-2026-11-01.json");
const austin = (Array.isArray(pool) ? pool : []).map((r) => ({
  name: "",
  handle: r.handle || "",
  market: "Austin",
  category: r.category || "",
  followers: null,
  email: r.email || null,
  emailSource: r.evidence || "",
  city: "Austin",
  contact_state: "emailed",
  source: "austin-email-pool",
}));
writeResilient(path.join(OUT, "recruiter-seed-austin.json"), JSON.stringify(austin));
console.log("austin pool:", austin.length);
console.log("SEEDS DONE");
