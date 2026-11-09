// Build -160 verification: the multi-market SWITCH (Jeff,
// 2026-11-09, Option B — "add the switch with the travel
// warning"). Canon amendment: a declared % in a non-home market
// lists NOBODY by itself. Listing requires the creator's
// per-market switch ON (audienceMarkets entry.active !== false)
// under the travel acknowledgement. Legacy entries with no flag
// read as ON (nobody unlists overnight); new declarations
// default OFF at the surfaces that create them.
//
// Proves, end to end:
//   lib: normalize preserves a boolean flag (rides with the
//     winning share on dupes, never invented); isListedInMarket
//     and listedMarketsFor gate on it; declaredOffMarketsFor
//     names the off set; gateMarketsFor counts home always and
//     a non-home market only when ON + (share >= gate floor or
//     IG-Verified); the breakdown drops an OFF market into
//     "everywhere else".
//   api: a declaration saved OFF is stored OFF, absent from the
//     founding card's listedMarkets, present in declaredMarkets,
//     absent from that market's Local List and from an Austin
//     business's offer reach, and absent from the gate supply
//     matrix. Flipping ON lists her everywhere at once, records
//     the travel acknowledgement on the audience_markets_updated
//     event, and counts her in the gate matrix at her IN-MARKET
//     share. Flipping back OFF unlists instantly. A flagless
//     (legacy) declaration still lists. A switched-ON share
//     between the 5% listing floor and the 10% gate floor lists
//     but does NOT count toward the gate.
// Run: node scripts/verify-build160.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const am = require("../netlify/functions/lib/audience-markets.js");

const PORT = 8961;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "verify-admin-pw-160";
const DB = path.join(os.tmpdir(), `signl-verify-build160-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`);
  }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const i = pair.indexOf("=");
      if (i > -1) {
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v) jar.set(k, v); else jar.delete(k);
      }
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { status: res.status, headers: res.headers, data };
  };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + "/api/bootstrap");
      if (res.ok) return true;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

// ---------- unit: the switch in the lib ----------
const fakeUser = (entries) => ({
  role: "creator",
  market: "Nashville",
  creator: { localAudiencePct: 60, audienceMarkets: entries },
});
check("lib: normalize preserves active:false verbatim",
  JSON.stringify(am.normalizeAudienceMarkets([{ market: "Austin", pct: 20, active: false }], "Nashville")) === JSON.stringify([{ market: "Austin", pct: 20, active: false }]));
check("lib: normalize never invents a flag for flagless input",
  JSON.stringify(am.normalizeAudienceMarkets([{ market: "Austin", pct: 20 }], "Nashville")) === JSON.stringify([{ market: "Austin", pct: 20 }]));
check("lib: on dupes the winning share carries its own flag",
  JSON.stringify(am.normalizeAudienceMarkets([{ market: "Austin", pct: 20, active: true }, { market: "Austin", pct: 25, active: false }], "Nashville")) === JSON.stringify([{ market: "Austin", pct: 25, active: false }]));
check("lib: legacy flagless declaration at 20% still lists (nobody unlists overnight)",
  am.isListedInMarket(fakeUser([{ market: "Austin", pct: 20 }]), "Austin") === true);
check("lib: switched-OFF declaration at 20% does NOT list",
  am.isListedInMarket(fakeUser([{ market: "Austin", pct: 20, active: false }]), "Austin") === false);
check("lib: switched-ON declaration at 20% lists",
  am.isListedInMarket(fakeUser([{ market: "Austin", pct: 20, active: true }]), "Austin") === true);
check("lib: switched-ON below the 5% floor still does not list",
  am.isListedInMarket(fakeUser([{ market: "Austin", pct: 3, active: true }]), "Austin") === false);
check("lib: listedMarketsFor drops the OFF market, keeps home + legacy",
  JSON.stringify(am.listedMarketsFor(fakeUser([{ market: "Austin", pct: 20, active: false }, { market: "Denver", pct: 30 }])).map((e) => e.market)) === JSON.stringify(["Nashville", "Denver"]));
check("lib: declaredOffMarketsFor names only the OFF declarations",
  JSON.stringify(am.declaredOffMarketsFor(fakeUser([{ market: "Austin", pct: 20, active: false }, { market: "Denver", pct: 30 }]))) === JSON.stringify([{ market: "Austin", pct: 20 }]));
check("lib: breakdown folds an OFF market into everywhere else",
  (() => { const b = am.audienceBreakdownFor(fakeUser([{ market: "Austin", pct: 20, active: false }])); return b && b.segments.length === 1 && b.elsewherePct === 40; })(),
  JSON.stringify(am.audienceBreakdownFor(fakeUser([{ market: "Austin", pct: 20, active: false }]))));
check("lib: gate counts home always",
  JSON.stringify(am.gateMarketsFor(fakeUser([]), 10).map((e) => e.market)) === JSON.stringify(["Nashville"]));
check("lib: gate counts a switched-ON market at/above the gate floor",
  JSON.stringify(am.gateMarketsFor(fakeUser([{ market: "Austin", pct: 20, active: true }]), 10).map((e) => e.market)) === JSON.stringify(["Nashville", "Austin"]));
check("lib: gate ignores a switched-OFF market even at 40%",
  JSON.stringify(am.gateMarketsFor(fakeUser([{ market: "Austin", pct: 40, active: false }]), 10).map((e) => e.market)) === JSON.stringify(["Nashville"]));
check("lib: gate ignores a switched-ON market between floors (7%: lists, not gate supply)",
  JSON.stringify(am.gateMarketsFor(fakeUser([{ market: "Austin", pct: 7, active: true }]), 10).map((e) => e.market)) === JSON.stringify(["Nashville"]));
check("lib: gate counts a legacy flagless market at/above the gate floor",
  JSON.stringify(am.gateMarketsFor(fakeUser([{ market: "Austin", pct: 20 }]), 10).map((e) => e.market)) === JSON.stringify(["Nashville", "Austin"]));

const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
  cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
  env: {
    ...process.env,
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: DB,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    APP_URL: BASE,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

try {
  const up = await waitForServer();
  check("dev server boots and /api/bootstrap responds", up);
  if (!up) throw new Error("server did not start");

  const admin = client();
  const adminLogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("admin signs in", adminLogin.status === 200 && adminLogin.data.user.role === "admin");

  // ---------- the toggle creator ----------
  const tess = client();
  const tessReg = await tess("POST", "/api/auth/register", {
    role: "creator",
    name: "Tessa Toggle",
    email: "tessa@fixtures.dev",
    password: "tessa-pass-1234",
    market: "Nashville",
    city: "Nashville",
    handle: "tessatoggle160",
    followerCount: 9000,
    localAudiencePct: 60,
    categories: ["Food & Drink"],
    ...AGREE,
  });
  check("toggle creator registers complete (201)", tessReg.status === 201 && tessReg.data.user.creator.profileComplete === true, JSON.stringify(tessReg.data).slice(0, 200));
  const tessId = tessReg.data.user.id;
  const approveTess = await admin("POST", "/api/admin/review", { userId: tessId, decision: "approve" });
  check("admin approves the toggle creator", approveTess.status === 200 && approveTess.data.user.status === "approved");
  // The Local List carries finished PUBLIC profiles (the same
  // gate verify-multimarket's Mia passes): public page on, a
  // rate and a best-work link saved.
  const tessPublic = await tess("PATCH", "/api/me/profile", {
    publicPage: true,
    paidRate: 200,
    bestWork: ["https://www.instagram.com/reel/ABC123xyz/"],
  });
  check("toggle creator goes public (Local List eligible)", tessPublic.status === 200, JSON.stringify(tessPublic.data).slice(0, 200));

  const localListHandles = async (market) => {
    const r = await client()("GET", `/api/public/local-list?market=${encodeURIComponent(market)}`);
    return (((r.data && r.data.categories) || []).flatMap((c) => c.creators || [])).map((e) => e.handle);
  };
  const gateSupply = async (market, cat) => {
    const r = await admin("GET", "/api/admin/stats/data");
    const matrix = (r.data && r.data.matrix) || {};
    return (((matrix[market] || {})[cat]) || {}).supply || 0;
  };
  const gateBenchmark = async (market, cat) => {
    const r = await admin("GET", "/api/admin/stats/data");
    const b = (r.data && r.data.benchmarks) || {};
    return b[`${market}|${cat}`] || null;
  };

  // ---------- declaration saved OFF ----------
  const offPatch = await tess("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Austin", pct: 20, active: false }] });
  check("OFF declaration stores with its flag",
    offPatch.status === 200 && JSON.stringify(offPatch.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Austin", pct: 20, active: false }]),
    JSON.stringify(offPatch.data.user && offPatch.data.user.creator && offPatch.data.user.creator.audienceMarkets));
  const foundingOff = await tess("GET", "/api/me/founding");
  const cardOff = foundingOff.data.card || {};
  check("founding card lists home only while Austin is OFF",
    JSON.stringify((cardOff.listedMarkets || []).map((e) => e.market)) === JSON.stringify(["Nashville"]),
    JSON.stringify(cardOff.listedMarkets));
  check("founding card names Austin as declared (not listed)",
    JSON.stringify(cardOff.declaredMarkets || []) === JSON.stringify([{ market: "Austin", pct: 20 }]),
    JSON.stringify(cardOff.declaredMarkets));
  check("Local List Austin does NOT carry her while OFF", !(await localListHandles("Austin")).includes("tessatoggle160"));
  check("Local List Nashville carries her (home, as always)", (await localListHandles("Nashville")).includes("tessatoggle160"));
  check("gate matrix: Austin Food & Drink supply excludes the OFF declaration", (await gateSupply("Austin", "Food & Drink")) === 0);
  check("gate matrix: Nashville Food & Drink supply counts her at home", (await gateSupply("Nashville", "Food & Drink")) === 1);

  // ---------- the Austin business + offer reach while OFF ----------
  const biz = client();
  const bizReg = await biz("POST", "/api/auth/register", {
    role: "business",
    name: "Austin Owner",
    businessName: "Toggle Tacos",
    email: "atxbiz160@fixtures.dev",
    password: "business-pass-123",
    market: "Austin",
    city: "Austin",
    category: "Restaurant",
    planId: "growth",
    agreedTerms: true,
  });
  const bizId = bizReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: bizId, decision: "approve" });
  const activateBiz = await admin("POST", "/api/admin/businesses/activate", { userId: bizId });
  check("Austin business approved + activated", activateBiz.status === 200 && activateBiz.data.user.business.accessState === "active");
  const openOffer = await biz("POST", "/api/offers", { title: "Austin toggle tasting", whatComped: "Tasting menu for two", dollarCap: 100, spots: 2, visitWindow: "Any evening this week" });
  check("Austin business posts an open offer", openOffer.status === 201 && openOffer.data.offer.status === "open", JSON.stringify(openOffer.data).slice(0, 200));
  const offerId = openOffer.data.offer.id;
  const boardOff = await tess("GET", "/api/open-offers");
  check("the Austin offer does NOT reach her board while OFF", !(boardOff.data.offers || []).some((o) => o.id === offerId));
  const applyOff = await tess("POST", `/api/offers/${offerId}/apply`, {});
  check("applying while OFF is refused with the listing reason (403)",
    applyOff.status === 403 && /not listed in/.test(applyOff.data.error || ""), JSON.stringify(applyOff.data));

  // ---------- flip ON: listed everywhere, ack recorded ----------
  const onPatch = await tess("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Austin", pct: 20, active: true }] });
  check("ON declaration stores with its flag",
    onPatch.status === 200 && JSON.stringify(onPatch.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Austin", pct: 20, active: true }]),
    JSON.stringify(onPatch.data.user && onPatch.data.user.creator && onPatch.data.user.creator.audienceMarkets));
  const foundingOn = await tess("GET", "/api/me/founding");
  const cardOn = foundingOn.data.card || {};
  check("founding card lists Nashville + Austin once ON",
    JSON.stringify((cardOn.listedMarkets || []).map((e) => e.market)) === JSON.stringify(["Nashville", "Austin"]),
    JSON.stringify(cardOn.listedMarkets));
  check("founding card declaredMarkets empties once ON", JSON.stringify(cardOn.declaredMarkets || []) === JSON.stringify([]));
  check("Local List Austin carries her once ON", (await localListHandles("Austin")).includes("tessatoggle160"));
  const boardOn = await tess("GET", "/api/open-offers");
  check("the Austin offer reaches her board once ON", (boardOn.data.offers || []).some((o) => o.id === offerId));
  const applyOn = await tess("POST", `/api/offers/${offerId}/apply`, {});
  check("her application lands once ON, snapshotted at her Austin share",
    applyOn.status === 201 && applyOn.data.application.snapshot.localAudiencePct === 20, JSON.stringify(applyOn.data).slice(0, 250));
  check("gate matrix: Austin Food & Drink supply counts her once ON", (await gateSupply("Austin", "Food & Drink")) === 1);
  const bench = await gateBenchmark("Austin", "Food & Drink");
  check("gate benchmark for the Austin cell reads her IN-MARKET share (20, not home 60)",
    !!bench && bench.medianLocalPct === 20, JSON.stringify(bench));

  // ---------- the travel acknowledgement is a stored fact ----------
  const evRes = await admin("GET", `/api/admin/events?type=audience_markets_updated&actor=${tessId}&limit=50`);
  const evs = (evRes.data.events || []).filter((e) => e.subjectId === tessId);
  const ackEv = evs.find((e) => e.data && Array.isArray(e.data.travelAckMarkets) && e.data.travelAckMarkets.includes("Austin"));
  check("the toggle-ON save recorded the travel acknowledgement (Austin, timestamped)",
    !!ackEv && typeof ackEv.data.travelAckAt === "string" && ackEv.data.travelAckAt.length > 0,
    JSON.stringify(evs.map((e) => e.data)));
  const offEv = evs.find((e) => e.data && Array.isArray(e.data.markets) && e.data.markets.some((m) => m.market === "Austin" && m.active === false));
  check("the OFF save's event carries the flag and NO acknowledgement",
    !!offEv && !(offEv.data.travelAckMarkets && offEv.data.travelAckMarkets.length),
    JSON.stringify(offEv && offEv.data));
  // A no-op re-save of the same ON state flips nothing: no new ack.
  await tess("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Austin", pct: 20, active: true }] });
  const evRes2 = await admin("GET", `/api/admin/events?type=audience_markets_updated&actor=${tessId}&limit=50`);
  const ackCount = (evRes2.data.events || []).filter((e) => e.subjectId === tessId && e.data && Array.isArray(e.data.travelAckMarkets) && e.data.travelAckMarkets.includes("Austin")).length;
  check("re-saving the same ON state records no second acknowledgement", ackCount === 1, `ack events: ${ackCount}`);

  // ---------- flip back OFF: instant unlist ----------
  await tess("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Austin", pct: 20, active: false }] });
  check("Local List Austin drops her the moment she flips OFF", !(await localListHandles("Austin")).includes("tessatoggle160"));
  check("gate matrix: Austin supply drops back to 0 once OFF", (await gateSupply("Austin", "Food & Drink")) === 0);

  // ---------- legacy flagless declaration still lists ----------
  const legacyPatch = await tess("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Denver", pct: 25 }] });
  check("flagless declaration stores flagless (normalize invents nothing)",
    legacyPatch.status === 200 && JSON.stringify(legacyPatch.data.user.creator.audienceMarkets) === JSON.stringify([{ market: "Denver", pct: 25 }]),
    JSON.stringify(legacyPatch.data.user && legacyPatch.data.user.creator && legacyPatch.data.user.creator.audienceMarkets));
  check("Local List Denver carries her on the legacy declaration", (await localListHandles("Denver")).includes("tessatoggle160"));

  // ---------- between the floors: lists, but no gate supply ----------
  await tess("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Chicago", pct: 7, active: true }] });
  check("a switched-ON 7% share lists her in Chicago", (await localListHandles("Chicago")).includes("tessatoggle160"));
  check("gate matrix: Chicago supply stays 0 at 7% (below the gate floor, unverified)", (await gateSupply("Chicago", "Food & Drink")) === 0);
  await tess("PATCH", "/api/me/profile", { audienceMarkets: [{ market: "Chicago", pct: 12, active: true }] });
  check("gate matrix: Chicago supply counts her at 12%", (await gateSupply("Chicago", "Food & Drink")) === 1);

  // ---------- the claim ride-along shape (what doQuickClaim sends) ----------
  const cleo = client();
  const cleoReg = await cleo("POST", "/api/auth/register", {
    role: "creator",
    quickClaim: true,
    email: "cleo@fixtures.dev",
    password: "cleo-pass-1234",
    market: "Nashville",
    handle: "cleoclaim160",
    ...AGREE,
  });
  const cleoId = cleoReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: cleoId, decision: "approve" });
  const cleoPatch = await cleo("PATCH", "/api/me/profile", {
    localAudiencePct: 55,
    audienceMarkets: [{ market: "Austin", pct: 15, active: false }],
  });
  check("claim-shaped save stores the declaration OFF",
    cleoPatch.status === 200 && JSON.stringify((cleoPatch.data.user.creator.audienceMarkets || [])) === JSON.stringify([{ market: "Austin", pct: 15, active: false }]),
    JSON.stringify(cleoPatch.data.user && cleoPatch.data.user.creator && cleoPatch.data.user.creator.audienceMarkets));
  const cleoFounding = await cleo("GET", "/api/me/founding");
  const cleoCard = cleoFounding.data.card || {};
  check("claim creator's card: home listed, Austin declared-not-listed",
    JSON.stringify((cleoCard.listedMarkets || []).map((e) => e.market)) === JSON.stringify(["Nashville"]) && JSON.stringify(cleoCard.declaredMarkets || []) === JSON.stringify([{ market: "Austin", pct: 15 }]),
    JSON.stringify({ listed: cleoCard.listedMarkets, declared: cleoCard.declaredMarkets }));

  console.log(`\nBuild -160 verification: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("FAILURES:");
    for (const f of failures) console.log(" - " + f);
  }
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
process.exit(failed ? 1 : 0);
