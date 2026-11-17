#!/usr/bin/env node
// Build -184: per-viewer playbook voice for the shared Biz Dev
// books. A shared lead's stored playbook sits in whoever's
// voice won the unification merge (Nashville: Tony's whole;
// Hampton Roads: section-mixed) — before -184 both men read
// that one voice, so Jeff's scripts introduced him as Tony.
// repLeadPayload now re-voices the rendered copy toward the
// viewer (Jeff <-> Tony phrase pairs), on the deep copy
// renderPlaybookLinks already makes; the stored record is
// never mutated by a read.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const bizdev = require("../netlify/functions/lib/bizdev.js");
const { revoicePlaybookForViewer, repLeadPayload } = bizdev._test;

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); } };
const J = (v) => JSON.stringify(v);

console.log("== the re-voicer, both directions ==");
const tonyNashville = {
  opener: "I'm Tony — I'm with Magpie. We're building the founding creator list here.",
  introEmail: "Hi, this is Tony with Magpie. Two minutes is all I need.\n\nTony Johnson\nMagpie — Nashville",
  beforeYouGo: "This one waits for Jeff's go before anyone walks in.",
  runsheet: ["Say: Tony here, I'm with Magpie."],
};
const forJeff = revoicePlaybookForViewer(tonyNashville, "HQ-JEFF", "Nashville");
check("Tony's opener reads as Jeff for Jeff", forJeff.opener.startsWith("I'm Jeff — I run Magpie."), forJeff.opener);
check("Tony's email intro reads as Jeff", forJeff.introEmail.includes("Hi, this is Jeff with Magpie"), forJeff.introEmail);
check("the signature becomes Jeff's", forJeff.introEmail.includes("Jeff Rimmer\nFounder, Magpie"), forJeff.introEmail);
check("the runsheet line re-voices", forJeff.runsheet[0] === "Say: Jeff here, I run Magpie.", forJeff.runsheet[0]);
check("'Jeff's go' survives untouched for Jeff", forJeff.beforeYouGo.includes("waits for Jeff's go"), forJeff.beforeYouGo);
check("no 'Tony' survives in Jeff's copy", !/Tony/.test(J(forJeff)), J(forJeff).slice(0, 200));
check("the stored playbook object is NOT mutated", tonyNashville.opener.startsWith("I'm Tony"), tonyNashville.opener);

const jeffHr = {
  opener: "Jeff Rimmer here, founder of Magpie.\n\nWe're building our Hampton Roads founding creator list.",
  dmOpener: "I'm Jeff — I'm local, I run Magpie. Quick hello from the beach.",
  introEmail: "Wanted to introduce myself. — Jeff",
  phone: { owner: "I'm Jeff Rimmer — I live here in Hampton Roads, and I run Magpie. Is the owner around?" },
};
const forTony = revoicePlaybookForViewer(jeffHr, "HR-TONY", "Hampton Roads");
check("Jeff's HR opener reads as Tony for Tony", forTony.opener.startsWith("Tony Johnson here — I'm with Magpie."), forTony.opener);
check("Jeff's local line re-voices to Tony's", forTony.dmOpener.startsWith("I'm Tony — I'm local, I'm with Magpie."), forTony.dmOpener);
check("the sign-off becomes Tony's", forTony.introEmail.endsWith("— Tony"), forTony.introEmail);
check("the phone intro re-voices", forTony.phone.owner.startsWith("I'm Tony Johnson — I live here in Hampton Roads, and I'm helping Magpie."), forTony.phone.owner);
check("no 'Jeff' survives in Tony's copy (outside Jeff's go)", !/Jeff/.test(J(forTony).split("Jeff's go").join("")), J(forTony).slice(0, 200));

console.log("== mixed sections, market signatures, safety ==");
const mixed = {
  a: "I'm Tony — I'm with Magpie.",
  b: "I'm Jeff — I run Magpie.",
  sig: "Tony Johnson\nMagpie — Hampton Roads",
};
const mixedForJeff = revoicePlaybookForViewer(mixed, "HQ-JEFF", "Nashville");
check("mixed: Tony section -> Jeff", mixedForJeff.a.startsWith("I'm Jeff"), mixedForJeff.a);
check("mixed: Jeff section stays Jeff", mixedForJeff.b.startsWith("I'm Jeff"), mixedForJeff.b);
check("mixed: an HR Tony signature becomes Jeff's even on a Nashville lead", mixedForJeff.sig === "Jeff Rimmer\nFounder, Magpie", mixedForJeff.sig);
const mixedForTony = revoicePlaybookForViewer(mixed, "HR-TONY", "Nashville");
check("mixed: Jeff section -> Tony", mixedForTony.b.startsWith("I'm Tony"), mixedForTony.b);
check("mixed: Tony's own signature stays as stored for Tony (name right; market is the section's own)", mixedForTony.sig === "Tony Johnson\nMagpie — Hampton Roads", mixedForTony.sig);
const jeffSig = revoicePlaybookForViewer({ sig: "Jeff Rimmer\nFounder, Magpie" }, "HR-TONY", "Nashville");
check("Jeff's signature becomes Tony's with the lead's market", jeffSig.sig === "Tony Johnson\nMagpie — Nashville", jeffSig.sig);
check("unknown rep code passes the playbook through", revoicePlaybookForViewer(mixed, "XX-NONE", "Nashville") === mixed);
check("null playbook stays null", revoicePlaybookForViewer(null, "HQ-JEFF", "Nashville") === null);
check("a playbook with no voice lines renders unchanged in content", revoicePlaybookForViewer({ note: "Ask for the owner." }, "HR-TONY", "Nashville").note === "Ask for the owner.");

console.log("== repLeadPayload integration ==");
const lead = {
  id: "lead-184", name: "Fixture Cafe", category: "Coffee & Bakery", marketId: "nashville", marketName: "Nashville",
  stage: "Not visited yet", source: "HQ-loaded", createdAt: "2026-11-12T00:00:00.000Z",
  sharedBook: true, attribution: { repCode: "HR-TONY", firstTouchAt: null },
  playbook: JSON.parse(JSON.stringify(tonyNashville)),
  flags: {}, founding: { status: "Not claimed" },
};
const jeffPayload = repLeadPayload(lead, { full: true, viewerRepCode: "HQ-JEFF" });
check("Jeff's payload playbook is in Jeff's voice", jeffPayload.playbook.opener.startsWith("I'm Jeff"), jeffPayload.playbook.opener);
check("Jeff's claim link carries HIS rep code", (jeffPayload.claimLink || "").includes("rep=HQ-JEFF"), jeffPayload.claimLink);
const tonyPayload = repLeadPayload(lead, { full: true, viewerRepCode: "HR-TONY" });
check("Tony's payload playbook stays in Tony's voice", tonyPayload.playbook.opener.startsWith("I'm Tony"), tonyPayload.playbook.opener);
check("Tony's claim link carries HIS rep code", (tonyPayload.claimLink || "").includes("rep=HR-TONY"), tonyPayload.claimLink);
check("the stored lead's playbook is byte-identical after both reads", J(lead.playbook) === J(tonyNashville));
check("the stored lead's attribution is untouched", lead.attribution.repCode === "HR-TONY");
const soloLead = { ...lead, id: "lead-184b", sharedBook: false, playbook: JSON.parse(JSON.stringify(tonyNashville)) };
const soloPayload = repLeadPayload(soloLead, { full: true, viewerRepCode: "HQ-JEFF" });
check("a NON-shared lead is never re-voiced", soloPayload.playbook.opener.startsWith("I'm Tony"), soloPayload.playbook.opener);

console.log("== pack census: the REAL playbooks, both directions ==");
// The fixture battery above can only test phrases it knows.
// This census runs every playbook in the shipped packs through
// the re-voicer — the check that would have caught the first
// -184 table's Hampton Roads gap (Tony's comma openers and
// named greetings were not in the table).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "netlify", "functions", "lib");
const stringsOf = (v, acc = []) => {
  if (typeof v === "string") acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, acc));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => stringsOf(x, acc));
  return acc;
};
const census = (file, marketName) => {
  const pack = JSON.parse(fs.readFileSync(path.join(LIB, file), "utf8"));
  const leads = (pack.leads || []).filter((l) => l.playbook);
  let strings = 0;
  const survivors = { jeffSeesTony: [], tonySeesJeff: [], tonySeesJeffOpener: [] };
  for (const lead of leads) {
    for (const s of stringsOf(lead.playbook)) {
      strings++;
      const forJeff = revoicePlaybookForViewer({ s }, "HQ-JEFF", marketName).s;
      const forTony = revoicePlaybookForViewer({ s }, "HR-TONY", marketName).s;
      if (/Tony/.test(forJeff)) survivors.jeffSeesTony.push(forJeff.slice(0, 90));
      if (/Jeff/.test(forTony.split("Jeff's go").join(""))) survivors.tonySeesJeff.push(forTony.slice(0, 90));
      if (/I'm Jeff|this is Jeff|Jeff Rimmer here|Jeff here, I run|Jeff Rimmer\nFounder/.test(forTony)) survivors.tonySeesJeffOpener.push(forTony.slice(0, 90));
    }
  }
  return { count: leads.length, strings, survivors };
};
const hr = census("bizdev-enrich-hr-157.json", "Hampton Roads");
check(`HR pack census ran (${hr.count} playbooks, ${hr.strings} strings)`, hr.count === 32 && hr.strings > 500, `${hr.count}/${hr.strings}`);
check("HR -> Jeff: zero 'Tony' survives anywhere", hr.survivors.jeffSeesTony.length === 0, hr.survivors.jeffSeesTony.slice(0, 3).join(" | "));
check("HR -> Tony: zero first-person Jeff openers/signatures survive (legit HQ mentions may stay)", hr.survivors.tonySeesJeffOpener.length === 0, hr.survivors.tonySeesJeffOpener.slice(0, 3).join(" | "));
const nash = census("bizdev-enrich-nashville.json", "Nashville");
check(`Nashville pack census ran (${nash.count} playbooks, ${nash.strings} strings)`, nash.count === 57 && nash.strings > 1500, `${nash.count}/${nash.strings}`);
check("Nashville -> Jeff: zero 'Tony' survives", nash.survivors.jeffSeesTony.length === 0, nash.survivors.jeffSeesTony.slice(0, 3).join(" | "));
check("Nashville -> Tony: zero 'Jeff' survives outside 'Jeff's go'", nash.survivors.tonySeesJeff.length === 0, nash.survivors.tonySeesJeff.slice(0, 3).join(" | "));

console.log(`\nverify-build184: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
