// verify-igprefill: the Instagram handle-onboarding prefill service.
// Deterministic by default: every fetch is stubbed with fixtures
// shaped on the real pages proven on 2026-10-28. The live route is
// exercised only with SIGNL_IG_LIVE=1 (it depends on Instagram's
// egress mood and must never gate the chain).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ig = require("../netlify/functions/lib/ig-prefill.js");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? " — " + extra : "")); }
}

function ogPage({ name, handle, followers, following, posts, img }) {
  return `<!DOCTYPE html><html><head>
<meta property="og:type" content="profile" />
<meta content="${img}" property="og:image" />
<meta property="og:title" content="${name} (&#064;${handle}) &#x2022; Instagram photos and videos" />
<meta property="og:description" content="${followers} Followers, ${following} Following, ${posts} Posts - See Instagram photos and videos from ${name} (&#064;${handle})" />
</head><body></body></html>`;
}
const FIXTURE_SIGNL = ogPage({ name: "Signl", handle: "joinsignl", followers: "993", following: "108", posts: "14", img: "https://scontent.cdninstagram.com/pic_signl.jpg" });
const FIXTURE_JESSICA = ogPage({ name: "Jessica Shea Photography&#174;", handle: "jsheaphoto22", followers: "2,305", following: "1,478", posts: "1,978", img: "https://scontent.cdninstagram.com/pic_jessica.jpg" });
const FIXTURE_KM = ogPage({ name: "Big Creator", handle: "bigcreator", followers: "12.4K", following: "312", posts: "860", img: "https://scontent.cdninstagram.com/pic_big.jpg" });
const SHELL = "<!DOCTYPE html><html><head><title>Instagram</title></head><body><div id='react-root'></div></body></html>";

function stubFetch(map) {
  return async (url) => {
    const handle = /instagram\.com\/([a-z0-9._]+)\//.exec(url)[1];
    const entry = map[handle];
    if (!entry) return { status: 200, text: async () => SHELL };
    if (entry.status) return { status: entry.status, text: async () => "" };
    return { status: 200, text: async () => entry.html };
  };
}

console.log("— handle normalization —");
check("plain handle", ig.normalizeHandle("joinsignl") === "joinsignl");
check("@handle", ig.normalizeHandle("@JoinSignl") === "joinsignl");
check("profile URL", ig.normalizeHandle("https://www.instagram.com/joinsignl/?hl=en") === "joinsignl");
check("junk rejected", ig.normalizeHandle("not a handle!") === null);
check("empty rejected", ig.normalizeHandle("  ") === null);
check("leading dot rejected", ig.normalizeHandle(".joinsignl") === null);

console.log("— OG parsing (proven shapes) —");
const p1 = ig.parseOgProfile(FIXTURE_SIGNL);
check("signl name", p1 && p1.displayName === "Signl");
check("signl followers exact", p1 && p1.followerCount === 993 && p1.followerApprox === false);
check("signl posts", p1 && p1.postCount === 14);
check("signl photo", p1 && /pic_signl\.jpg$/.test(p1.photoUrl));
const p2 = ig.parseOgProfile(FIXTURE_JESSICA);
check("comma counts parse", p2 && p2.followerCount === 2305 && p2.postCount === 1978);
check("entity in name decoded", p2 && p2.displayName.includes("®"));
const p3 = ig.parseOgProfile(FIXTURE_KM);
check("K suffix parses approx", p3 && p3.followerCount === 12400 && p3.followerApprox === true);
check("shell page parses to null", ig.parseOgProfile(SHELL) === null);

console.log("— fetch ladder with stubs —");
ig._clearCache();
const map = { joinsignl: { html: FIXTURE_SIGNL }, limited: { status: 429 }, gone: { status: 404 } };
let r = await ig.fetchIgProfile("joinsignl", { fetchImpl: stubFetch(map), cooldownMs: 0 });
check("fetch ok", r.ok === true && r.profile.followerCount === 993);
r = await ig.fetchIgProfile("joinsignl", { fetchImpl: stubFetch(map), cooldownMs: 0 });
check("second fetch cached", r.ok === true && r.cached === true);
r = await ig.fetchIgProfile("limited", { fetchImpl: stubFetch(map), cooldownMs: 0 });
check("429 is rate_limited", r.ok === false && r.reason === "rate_limited");
r = await ig.fetchIgProfile("gone", { fetchImpl: stubFetch(map), cooldownMs: 0 });
check("404 is not_found", r.ok === false && r.reason === "not_found");
r = await ig.fetchIgProfile("nope.zz9x", { fetchImpl: stubFetch(map), cooldownMs: 0 });
check("shell 200 is not_found", r.ok === false && r.reason === "not_found");
r = await ig.fetchIgProfile("boom", { fetchImpl: async () => { throw new Error("net down"); }, cooldownMs: 0 });
check("network error is fetch_failed", r.ok === false && r.reason === "fetch_failed");
r = await ig.fetchIgProfile("bad handle!", { fetchImpl: stubFetch(map), cooldownMs: 0 });
check("invalid handle short-circuits", r.ok === false && r.reason === "invalid_handle");

console.log("— creator prefill guardrails —");
const cp = ig.creatorPrefill(p1);
check("creator fields carry name", cp.fields.displayName.value === "Signl");
check("creator fields carry followers", cp.fields.followerCount.value === 993);
const fieldJson = JSON.stringify(cp.fields);
for (const forbidden of ["localAudiencePct", "spanishAudiencePct", "paidRate", "licensingFee", "demographic"]) {
  check("fields never contain " + forbidden, !fieldJson.includes(forbidden));
}
for (const asked of ["localAudiencePct", "spanishAudiencePct", "paidRate", "licensingFee"]) {
  const a = cp.ask.find((x) => x.field === asked);
  check(asked + " is a question, never_prefill", a && a.why === "never_prefill");
}
check("categories asked, not fetched", cp.ask.some((x) => x.field === "categories" && x.why === "not_fetchable"));

console.log("— business prefill —");
const bp = ig.businessPrefill(p2);
check("business name prefilled", bp.fields.businessName.value.includes("Jessica Shea"));
check("packet handle prefilled", bp.fields.packetHandle.value === "jsheaphoto22");
check("category asked", bp.ask.some((x) => x.field === "category"));
check("business fields hold no category", !JSON.stringify(bp.fields).includes("category"));

console.log("— confirmation contract: edits win —");
const edited = ig.applyEdits(cp.fields, { displayName: "SIGNL HQ", followerCount: 1000, evilKey: "x" });
check("edited name wins", edited.values.displayName === "SIGNL HQ");
check("edited count wins", edited.values.followerCount === 1000);
check("untouched field keeps fetch", edited.values.handle === "joinsignl");
check("unknown edit dropped + reported", edited.dropped.includes("evilKey") && !("evilKey" in edited.values));
const cleared = ig.applyEdits(cp.fields, { photoUrl: "" });
check("empty edit clears", cleared.values.photoUrl === null);

console.log("— play suggestion rules —");
check("weekend food gets Weekend Fill", ig.suggestPlayForBusiness({ category: "Restaurant", weekendHeavy: true }).play === "weekend_fill");
check("opening gets Grand Opening", ig.suggestPlayForBusiness({ category: "Retail", opening: true }).play === "grand_opening");
check("attraction gets Event Night", ig.suggestPlayForBusiness({ category: "Attraction" }).play === "event_night");
check("plain retail gets Build Regulars", ig.suggestPlayForBusiness({ category: "Retail" }).play === "build_regulars");
check("food without weekend signal gets Build Regulars", ig.suggestPlayForBusiness({ category: "Coffee & Bakery" }).play === "build_regulars");
check("suggestion carries a label", ig.suggestPlayForBusiness({}).playLabel === "Build Regulars");

if (process.env.SIGNL_IG_LIVE === "1") {
  console.log("— LIVE route (opt-in) —");
  ig._clearCache();
  const live = await ig.fetchIgProfile("joinsignl", { cooldownMs: 0 });
  check("live @joinsignl parses", live.ok === true, live.reason || "");
  if (live.ok) {
    check("live name is Signl", live.profile.displayName === "Signl");
    check("live followers > 0", live.profile.followerCount > 0);
    console.log("  live values:", JSON.stringify(live.profile));
  }
} else {
  console.log("— live route skipped (set SIGNL_IG_LIVE=1 to exercise it) —");
}

console.log(`\nigprefill: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
