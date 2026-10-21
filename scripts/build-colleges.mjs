// Builds the bundled US colleges dataset for university
// autocomplete (Jeff, 2026-10-21). Source: US Department of
// Education, IPEDS Institutional Characteristics header file
// (HD), the same institution directory behind College Scorecard:
// https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip (public,
// no key). The dataset is bundled at build time; the app never
// calls a third party at runtime.
//
// Usage: node scripts/build-colleges.mjs /path/to/HD2024.csv
// Writes: public/data/us-colleges.json (client, lazy-loaded)
//         netlify/functions/lib/us-colleges.json (server copy)
// Slim record: { n: canonical IPEDS name, a: [aliases], c: city,
// s: state }. A small hand-map adds the abbreviations our launch
// markets actually type (VCU, ODU, UNC, NCSU, ...) on top of the
// IPEDS IALIAS field.
import fs from "node:fs";
import path from "node:path";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("usage: node scripts/build-colleges.mjs /path/to/HD2024.csv");
  process.exit(1);
}

// Minimal CSV parser (handles quoted fields with commas).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const HAND_ALIASES = {
  "Virginia Commonwealth University": ["VCU"],
  "Old Dominion University": ["ODU"],
  "William & Mary": ["W&M", "College of William and Mary"],
  "University of North Carolina at Chapel Hill": ["UNC", "UNC Chapel Hill"],
  "North Carolina State University at Raleigh": ["NCSU", "NC State"],
  "George Washington University": ["GWU", "GW"],
  "George Mason University": ["GMU"],
  "University of Maryland-College Park": ["UMD"],
  "Virginia Polytechnic Institute and State University": ["Virginia Tech", "VT"],
  "James Madison University": ["JMU"],
  "University of Virginia-Main Campus": ["UVA"],
  "Norfolk State University": ["NSU"],
  "Hampton University": ["HU"],
  "Christopher Newport University": ["CNU"],
  "Duke University": ["Duke"],
  "Howard University": ["HU"],
  "Georgetown University": ["Georgetown"],
  "American University": ["AU"],
  "University of Richmond": ["UR", "Richmond"],
  "Virginia State University": ["VSU"],
};

const text = fs.readFileSync(csvPath, "utf8");
const rows = parseCsv(text);
const header = rows[0].map((h) => h.trim());
const idx = (name) => header.indexOf(name);
const iName = idx("INSTNM");
const iAlias = idx("IALIAS");
const iCity = idx("CITY");
const iState = idx("STABBR");
if (iName < 0 || iCity < 0 || iState < 0) {
  console.error("HD header is missing INSTNM/CITY/STABBR");
  process.exit(1);
}

const seen = new Set();
const out = [];
for (const r of rows.slice(1)) {
  const n = (r[iName] || "").trim().replace(/\s+/g, " ");
  const c = (r[iCity] || "").trim().replace(/\s+/g, " ");
  const s = (r[iState] || "").trim();
  if (!n || !c || !s) continue;
  const key = `${n.toLowerCase()}|${s}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const aliases = new Set();
  if (iAlias >= 0 && r[iAlias]) {
    for (const a of r[iAlias].split("|")) {
      const t = a.trim().replace(/\s+/g, " ");
      if (t && t.toLowerCase() !== n.toLowerCase()) aliases.add(t);
    }
  }
  for (const a of HAND_ALIASES[n] || []) aliases.add(a);
  out.push({ n, a: [...aliases].slice(0, 6), c, s });
}
out.sort((x, y) => (x.n < y.n ? -1 : x.n > y.n ? 1 : 0));

const json = JSON.stringify(out);
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
for (const rel of ["public/data/us-colleges.json", "netlify/functions/lib/us-colleges.json"]) {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, json);
  console.log(`${rel}: ${out.length} institutions, ${(json.length / 1024).toFixed(0)} KB`);
}
