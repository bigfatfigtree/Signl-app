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

console.log(`\nverify-build184: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
