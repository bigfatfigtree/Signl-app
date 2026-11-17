#!/usr/bin/env node
// Build -183: the claim flow's city photo for New York City.
// claimPhotoFor slugifies the market NAME ("New York City" ->
// "new-york-city") but CLAIM_CITY_PHOTOS listed "new-york" and
// the file on disk was city-new-york.jpg, so NYC claims silently
// fell back to the generic welcome photo. The list entry and the
// file now use the name slug. This suite iterates EVERY market
// in the live bootstrap: whenever a city photo exists on disk
// for a market's name slug, the resolver must return it (never
// the fallback), and every listed photo must exist on disk.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };

console.log("== build -183: claim city photos ==");
check("BUILD_ID is 2026.11.16-183", fs.readFileSync(path.join(ROOT, "netlify", "functions", "lib", "build.js"), "utf8").includes('BUILD_ID = "2026.11.16-183"'));

const listMatch = appJs.match(/const CLAIM_CITY_PHOTOS = \[([^\]]+)\]/);
check("CLAIM_CITY_PHOTOS is parseable", !!listMatch);
const photos = listMatch ? [...listMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
check("the list carries new-york-city (not new-york)", photos.includes("new-york-city") && !photos.includes("new-york"), photos.join(","));
for (const slug of photos) {
  check(`photo file exists for ${slug}`, fs.existsSync(path.join(ROOT, "public", "assets", "claim", `city-${slug}.jpg`)));
}
check("the old city-new-york.jpg is gone", !fs.existsSync(path.join(ROOT, "public", "assets", "claim", "city-new-york.jpg")));

// Evaluate the real resolver out of the served source.
const fnStart = appJs.indexOf("const CLAIM_CITY_PHOTOS");
const fnEnd = appJs.indexOf("\n}", appJs.indexOf("function claimPhotoFor"));
const claimPhotoFor = new Function(`${appJs.slice(fnStart, fnEnd + 2)}; return claimPhotoFor;`)();
check("resolver: New York City -> its own photo", claimPhotoFor("New York City") === "/assets/claim/city-new-york-city.jpg", claimPhotoFor("New York City"));
check("resolver: Nashville still resolves", claimPhotoFor("Nashville") === "/assets/claim/city-nashville.jpg");
check("resolver: Virginia Beach still resolves", claimPhotoFor("Virginia Beach") === "/assets/claim/city-virginia-beach.jpg");
check("resolver: a market with no photo falls back", claimPhotoFor("Boston") === "/assets/claim/welcome.jpg", claimPhotoFor("Boston"));

// Every bootstrap market: if a photo file exists for its name
// slug, the resolver must hand it back.
const { MARKETS: markets } = createRequire(import.meta.url)(path.join(ROOT, "netlify", "functions", "lib", "markets.js"));
let photoMarkets = 0;
for (const m of markets) {
  const slug = String(m.name || "").trim().toLowerCase().replace(/\s+/g, "-");
  const hasFile = fs.existsSync(path.join(ROOT, "public", "assets", "claim", `city-${slug}.jpg`));
  if (hasFile) {
    photoMarkets++;
    check(`resolver serves ${m.name}'s photo`, claimPhotoFor(m.name) === `/assets/claim/city-${slug}.jpg`, claimPhotoFor(m.name));
  }
}
check("all 12 photo markets resolve", photoMarkets === 12, String(photoMarkets));

console.log(`\nverify-build183: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
