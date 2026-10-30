#!/usr/bin/env node
// Build 2026.10.30-42 verification: The Bench + Collabs.
// Jeff's governing rule: SIGNL never renders an empty or
// near-empty collection, and no creator ever sees how small a
// roster is. So the creator-facing Bench is state-based:
// FOUNDING (no list UI at all, a founding frame + Golden
// Tickets + Sig introductions), INTRODUCTION (one named
// personal card, correct at n=1, dismissible server-side so a
// pair is never re-suggested), and BENCH (the browsable roster,
// only at launch or on the Admin per-market override, category
// chips only for categories with at least 3 visible creators).
// No creator-count field exists on any bench payload. Collabs:
// a creator adds ONE +1 (finished, non-hidden, own market) to
// an application or a booking, picked only via the Sig
// suggestion or an exact name/handle search; the business
// approves or declines the PAIR, and declining leaves the
// original standing alone. Proof runs independently per
// creator; a +1 never fills an offer spot; on a paid booking
// the +1 is comped presence only.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8952;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "build42-admin@signl.local";
const ADMIN_PASSWORD = "build42-admin-pass";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} :: ${detail}`); }
}

function client() {
  const jar = new Map();
  const call = async (method, path, body) => {
    const headers = { "content-type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const part of sc) { const pair = part.split(";")[0]; const i = pair.indexOf("="); if (i > -1) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return call;
}

async function waitUp() {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.status) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

// The no-counts contract, enforced by shape: no key anywhere in
// a creator-facing bench payload may name a count or a total.
function countKeys(value, path = "", out = []) {
  if (Array.isArray(value)) { value.forEach((v, i) => countKeys(v, `${path}[${i}]`, out)); return out; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/count|total/i.test(k)) out.push(`${path}.${k}`);
      countKeys(v, `${path}.${k}`, out);
    }
  }
  return out;
}
function checkNoCounts(name, payload) {
  const bad = countKeys(payload);
  check(name, bad.length === 0, `count-like keys: ${bad.join(", ")}`);
}

async function makeCreator(admin, { name, email, handle, market, followers = 3200, localPct = 82, categories = ["Food & Drink"], streets = null }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market, city: market,
    handle, followerCount: followers, localAudiencePct: localPct, categories, primaryPlatform: "instagram", ...AGREE,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  if (streets) await c("PATCH", "/api/me/profile", { streets });
  return { client: c, id: reg.data.user.id, email, handle };
}

async function makeBusiness(admin, { name, businessName, email, market }) {
  const c = client();
  const reg = await c("POST", "/api/auth/register", {
    role: "business", name, businessName, email, password: "business-pass-123",
    market, city: market, category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`business ${businessName} failed: ${JSON.stringify(reg.data)}`);
  await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: reg.data.user.id });
  return { client: c, id: reg.data.user.id };
}

async function benchOf(creator) {
  const r = await creator.client("GET", "/api/me/bench");
  if (r.status !== 200) throw new Error(`bench failed for ${creator.handle}: ${JSON.stringify(r.data)}`);
  return r.data;
}

let server;
try {
  const dir = mkdtempSync(join(tmpdir(), "signl-build42-"));
  server = spawn(process.execPath, ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: join(dir, "db.json"), ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitUp();

  const admin = client();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(login.data)}`);
  // Every market starts founding. Nashville launches later in
  // the run, AFTER its creators exist: a creator approved with a
  // finished profile before launch holds Charter status, which
  // is what lets the collab flows apply inside a fresh offer's
  // Charter early-access window.

  // ---------- FOUNDING state: alone in the market ----------
  const vbSolo = await makeCreator(admin, { name: "Vb Solo", email: "vbsolo@fixtures.dev", handle: "vbsolo", market: "Virginia Beach", streets: ["Shore Drive"] });
  const soloBench = await benchOf(vbSolo);
  check("founding: a lone finished creator gets the founding state, not a list",
    soloBench.state === "founding" && soloBench.launched === false && Array.isArray(soloBench.creators) && soloBench.creators.length === 0,
    JSON.stringify(soloBench).slice(0, 200));
  check("founding: no introduction exists at n=0 others", soloBench.introduction === null, JSON.stringify(soloBench.introduction));
  checkNoCounts("founding: the bench payload carries no creator-count field", soloBench);

  // ---------- INTRODUCTION state: one other creator ----------
  const vbTwo = await makeCreator(admin, { name: "Vb Two", email: "vbtwo@fixtures.dev", handle: "vbtwo", market: "Virginia Beach", streets: ["Shore Drive"] });
  const pairBench = await benchOf(vbSolo);
  check("introduction: still the founding state (no list UI below launch)",
    pairBench.state === "founding" && pairBench.creators.length === 0, JSON.stringify(pairBench.state));
  check("introduction: Sig introduces the one other creator by name",
    !!pairBench.introduction && pairBench.introduction.creator.userId === vbTwo.id && pairBench.introduction.creator.name === "Vb Two" && pairBench.introduction.creator.localAudiencePct === 82,
    JSON.stringify(pairBench.introduction));
  const twoBench = await benchOf(vbTwo);
  check("introduction: the introduction runs both ways", !!twoBench.introduction && twoBench.introduction.creator.userId === vbSolo.id, JSON.stringify(twoBench.introduction));

  // ---------- visibility: default ON, OFF removes everywhere ----------
  await vbTwo.client("PATCH", "/api/me/profile", { showToCreators: false });
  const hiddenBench = await benchOf(vbSolo);
  check("visibility: turning Show me to other creators OFF removes the introduction",
    hiddenBench.introduction === null, JSON.stringify(hiddenBench.introduction));
  const lookHidden = await vbSolo.client("GET", "/api/me/bench/lookup?q=vbtwo");
  check("visibility: a hidden creator cannot be found by exact handle search",
    lookHidden.status === 200 && lookHidden.data.creator === null, JSON.stringify(lookHidden.data).slice(0, 160));
  const ownBench = await benchOf(vbTwo);
  check("visibility: hiding yourself does not hide the market from you",
    ownBench.showToCreators === false && !!ownBench.introduction && ownBench.introduction.creator.userId === vbSolo.id,
    JSON.stringify(ownBench).slice(0, 200));
  await vbTwo.client("PATCH", "/api/me/profile", { showToCreators: true });
  const backBench = await benchOf(vbSolo);
  check("visibility: turning it back ON restores the introduction", !!backBench.introduction && backBench.introduction.creator.userId === vbTwo.id, "");

  // ---------- lookup: exact only ----------
  const byHandle = await vbSolo.client("GET", "/api/me/bench/lookup?q=%40vbtwo");
  check("lookup: an exact @handle finds the creator", !!byHandle.data.creator && byHandle.data.creator.userId === vbTwo.id, JSON.stringify(byHandle.data).slice(0, 160));
  const byName = await vbSolo.client("GET", "/api/me/bench/lookup?q=" + encodeURIComponent("Vb Two"));
  check("lookup: an exact full name finds the creator", !!byName.data.creator && byName.data.creator.userId === vbTwo.id, "");
  const partial = await vbSolo.client("GET", "/api/me/bench/lookup?q=vb");
  check("lookup: a partial handle finds nothing (no browsable picking)", partial.data.creator === null, JSON.stringify(partial.data).slice(0, 120));
  checkNoCounts("lookup: the payload carries no creator-count field", byHandle.data);

  // ---------- Admin override opens the Bench pre-launch ----------
  const richA = await makeCreator(admin, { name: "Rich Ann", email: "richa@fixtures.dev", handle: "richann", market: "Richmond" });
  const richB = await makeCreator(admin, { name: "Rich Bob", email: "richb@fixtures.dev", handle: "richbob", market: "Richmond" });
  const richBefore = await benchOf(richA);
  check("override: Richmond starts in the founding state", richBefore.state === "founding", richBefore.state);
  const tgl = await admin("POST", "/api/admin/markets/bench-toggle", { market: "Richmond", open: true });
  check("override: the Admin bench toggle answers open", tgl.status === 200 && tgl.data.benchOpen === true, JSON.stringify(tgl.data).slice(0, 160));
  const richOpen = await benchOf(richA);
  // Build -47 (audit C6): at one other creator the named
  // introduction carries the page; the roster list stays home
  // instead of rendering a list of one (and the introduced
  // creator never repeats as a roster row).
  check("override: the Bench opens without launch; the introduction carries it, no one-person list (Build -47 C6)",
    richOpen.state === "bench" && richOpen.launched === false && richOpen.creators.length === 0 && richOpen.introduction && richOpen.introduction.creator.userId === richB.id,
    JSON.stringify(richOpen).slice(0, 240));
  const mkts = await admin("GET", "/api/admin/markets");
  const row = (n) => (mkts.data.markets || []).find((m) => m.name === n) || {};
  check("override: Admin markets report benchOpen per market (Richmond on, Virginia Beach off)",
    row("Richmond").benchOpen === true && row("Virginia Beach").benchOpen === false,
    JSON.stringify({ r: row("Richmond").benchOpen, vb: row("Virginia Beach").benchOpen }));
  await admin("POST", "/api/admin/markets/bench-toggle", { market: "Richmond", open: false });
  const richClosed = await benchOf(richA);
  check("override: closing returns the market to the founding state", richClosed.state === "founding" && richClosed.creators.length === 0, richClosed.state);

  // ---------- BENCH state in a launched market ----------
  // Fixtures first, while Nashville is still founding, so each
  // creator's Charter stamp lands (the founding read is what
  // stamps it); then the market launches.
  const nashA = await makeCreator(admin, { name: "Nash Ann", email: "nasha@fixtures.dev", handle: "nashann", market: "Nashville", followers: 3200, localPct: 82, streets: ["Main Street"] });
  const nashB = await makeCreator(admin, { name: "Nash Ben", email: "nashb@fixtures.dev", handle: "nashben", market: "Nashville", followers: 2000, localPct: 90, streets: ["Main Street"] });
  const nashC = await makeCreator(admin, { name: "Nash Cee", email: "nashc@fixtures.dev", handle: "nashcee", market: "Nashville", followers: 5000, localPct: 70, categories: ["Music"], streets: ["Music Row"] });
  const nashD = await makeCreator(admin, { name: "Nash Dee", email: "nashd@fixtures.dev", handle: "nashdee", market: "Nashville", followers: 3000, localPct: 60, categories: ["Music"], streets: ["Music Row"] });
  const nashE = await makeCreator(admin, { name: "Nash Eli", email: "nashe@fixtures.dev", handle: "nasheli", market: "Nashville", followers: 3000, localPct: 50, categories: ["Music"], streets: ["Music Row"] });
  for (const c of [nashA, nashB, nashC, nashD, nashE]) await c.client("GET", "/api/me/founding");
  await admin("POST", "/api/admin/markets/toggle", { market: "Nashville", live: true });
  const benchA = await benchOf(nashA);
  check("bench: a launched market serves the browsable state", benchA.state === "bench" && benchA.launched === true, benchA.state);
  // Build -47 (audit C6): the introduced creator (Nash Ben,
  // the scored introduction for Ann) is suppressed from the
  // roster rows in the same view; the rest stay local-first.
  check("bench: the roster holds the other finished creators minus the introduction, ordered by local reach (Build -47 C6)",
    benchA.creators.map((c) => c.userId).join(",") === [nashC.id, nashD.id, nashE.id].join(","),
    benchA.creators.map((c) => c.handle).join(","));
  check("bench: cards carry the business-facing fields and nothing private",
    benchA.creators.every((c) => typeof c.localAudiencePct === "number" && typeof c.handle === "string" && Array.isArray(c.categories) && !("email" in c) && !("paidRate" in c) && !("earnings" in c)),
    JSON.stringify(benchA.creators[0]).slice(0, 240));
  checkNoCounts("bench: the roster payload carries no creator-count field", benchA);
  check("chips: a category appears only with at least 3 visible creators (Music yes, Food & Drink no)",
    Array.isArray(benchA.categories) && benchA.categories.length === 1 && benchA.categories[0].name === "Music",
    JSON.stringify(benchA.categories));
  const benchC = await benchOf(nashC);
  check("chips: below 3 in every category, no chips at all",
    Array.isArray(benchC.categories) && benchC.categories.length === 0, JSON.stringify(benchC.categories));

  // ---------- introduction dismissal is permanent ----------
  check("pairing: the introduction pairs on shared street + category",
    !!benchA.introduction && benchA.introduction.creator.userId === nashB.id, JSON.stringify(benchA.introduction));
  const dis = await nashA.client("POST", "/api/me/bench/dismiss", { creatorId: nashB.id });
  check("dismissal: the dismiss call lands", dis.status === 200 && dis.data.ok === true, JSON.stringify(dis.data).slice(0, 120));
  const afterDis = await benchOf(nashA);
  check("dismissal: the pair is never re-suggested (no other scored pair exists)",
    afterDis.introduction === null, JSON.stringify(afterDis.introduction));
  const benchB = await benchOf(nashB);
  check("dismissal: the pair closes for both sides — Sig never re-pitches a dismissed pair",
    benchB.introduction === null, JSON.stringify(benchB.introduction));

  // ---------- hidden creators cannot be picked as a +1 ----------
  await nashE.client("PATCH", "/api/me/profile", { showToCreators: false });
  const benchA2 = await benchOf(nashA);
  check("visibility: a hidden creator leaves the launched roster too",
    !benchA2.creators.some((c) => c.userId === nashE.id), benchA2.creators.map((c) => c.handle).join(","));

  const biz = await makeBusiness(admin, { name: "Nash Owner", businessName: "Bench Kitchen", email: "benchbiz@fixtures.dev", market: "Nashville" });
  const offerRes = await biz.client("POST", "/api/offers", { title: "Collab Night", whatComped: "Dinner for two", includes: "Dinner for two", spots: 2, dollarCap: 100, covers: 2 });
  if (offerRes.status !== 201) throw new Error(`open offer failed: ${JSON.stringify(offerRes.data)}`);
  const offer = offerRes.data.offer;
  const hiddenPick = await nashA.client("POST", `/api/offers/${offer.id}/apply`, { plusOneCreatorId: nashE.id });
  check("collab: applying with a hidden +1 is refused in plain words",
    hiddenPick.status === 400 && /not showing themselves/.test(hiddenPick.data.error || ""), JSON.stringify(hiddenPick.data).slice(0, 200));
  const wrongMarket = await nashA.client("POST", `/api/offers/${offer.id}/apply`, { plusOneCreatorId: vbTwo.id });
  check("collab: a +1 from another market is refused", wrongMarket.status === 400, JSON.stringify(wrongMarket.data).slice(0, 160));
  await nashE.client("PATCH", "/api/me/profile", { showToCreators: true });

  // ---------- collab: apply as a pair, decline keeps the application ----------
  const applied = await nashA.client("POST", `/api/offers/${offer.id}/apply`, { plusOneCreatorId: nashB.id });
  check("collab: applying with a +1 lands", applied.status === 201 && !!applied.data.application, JSON.stringify(applied.data).slice(0, 200));
  const appId = applied.data.application.id;
  check("collab: my application carries the +1 snapshot",
    !!applied.data.application.plusOne && applied.data.application.plusOne.creatorId === nashB.id && applied.data.application.plusOne.name === "Nash Ben",
    JSON.stringify(applied.data.application.plusOne));
  checkNoCounts("collab: the +1 snapshot carries no count field", applied.data.application.plusOne || {});
  const stack1 = await biz.client("GET", `/api/offers/${offer.id}/applications`);
  const bizApp = (stack1.data.applications || []).find((a) => a.id === appId);
  check("collab: the business stack shows the pair", !!bizApp && !!bizApp.plusOne && bizApp.plusOne.creatorId === nashB.id, JSON.stringify(bizApp && bizApp.plusOne));
  const declined = await biz.client("POST", `/api/offers/${offer.id}/decline-pair`, { applicationId: appId });
  check("collab: the business can decline the +1 only", declined.status === 200 && declined.data.application.plusOne === null && declined.data.application.status === "applied",
    JSON.stringify(declined.data).slice(0, 200));
  const myApps1 = await nashA.client("GET", "/api/applications");
  const myApp1 = (myApps1.data.applications || []).find((a) => a.id === appId);
  check("collab: after a pair decline the application stands alone",
    !!myApp1 && myApp1.status === "applied" && !myApp1.plusOne, JSON.stringify(myApp1 && myApp1.status));
  const noBookings = await nashA.client("GET", "/api/bookings");
  check("collab: a pair decline books nothing", (noBookings.data.bookings || []).length === 0, JSON.stringify(noBookings.data).slice(0, 120));

  // ---------- collab: re-add, select the pair, independent proof ----------
  const readded = await nashA.client("POST", `/api/applications/${appId}/plus-one`, { plusOneCreatorId: nashB.id });
  check("collab: the creator can add a +1 to a waiting application",
    readded.status === 200 && !!readded.data.application.plusOne && readded.data.application.plusOne.creatorId === nashB.id,
    JSON.stringify(readded.data).slice(0, 200));
  const selected = await biz.client("POST", `/api/offers/${offer.id}/select`, { applicationId: appId });
  check("collab: selecting the application books the primary", selected.status === 201 && !!selected.data.booking, JSON.stringify(selected.data).slice(0, 200));
  const primary = selected.data.booking;
  check("collab: the primary booking names its +1",
    !!primary.collab && primary.collab.creatorId === nashB.id, JSON.stringify(primary.collab));
  const bBookings = await nashB.client("GET", "/api/bookings");
  const companion = (bBookings.data.bookings || []).find((b) => b.collabRole === "plusone");
  check("collab: the +1 holds their own booking on the same visit",
    !!companion && companion.collabPrimaryBookingId === primary.id && companion.offerId === offer.id && companion.code && companion.code !== primary.code,
    JSON.stringify(companion).slice(0, 240));
  const stack2 = await biz.client("GET", `/api/offers/${offer.id}/applications`);
  check("collab: a +1 never fills an offer spot (1 of 2 after booking a pair)",
    stack2.data.offer.filledCount === 1, JSON.stringify(stack2.data.offer.filledCount));
  await biz.client("POST", `/api/bookings/${primary.id}/confirm`, {});
  await biz.client("POST", `/api/bookings/${companion.id}/confirm`, {});
  const bPost = await nashB.client("POST", "/api/posts", { bookingId: companion.id, url: "https://www.instagram.com/p/B42PLUS/", includesDisclosure: true });
  check("collab: the +1 delivers their own post", bPost.status === 201, JSON.stringify(bPost.data).slice(0, 160));
  const aView = await nashA.client("GET", "/api/bookings");
  const aPrimary = (aView.data.bookings || []).find((b) => b.id === primary.id);
  check("collab: the +1's post does not complete the primary's card",
    !!aPrimary && !aPrimary.post, JSON.stringify(aPrimary && aPrimary.post));
  const bView = await nashB.client("GET", "/api/bookings");
  const bComp = (bView.data.bookings || []).find((b) => b.id === companion.id);
  check("collab: the +1's own card shows their post", !!bComp && !!bComp.post, "");
  const aPost = await nashA.client("POST", "/api/posts", { bookingId: primary.id, url: "https://www.instagram.com/p/B42PRIMARY/", includesDisclosure: true });
  check("collab: the primary delivers independently", aPost.status === 201, JSON.stringify(aPost.data).slice(0, 160));

  // ---------- booking-level +1: add, business decline, re-add, remove ----------
  const invite = await biz.client("POST", "/api/offers", { title: "Solo First", whatComped: "Dinner for two", dollarCap: 60, spots: 1, includesAlcohol: false, creatorId: nashC.id });
  if (invite.status !== 201) throw new Error(`direct invite failed: ${JSON.stringify(invite.data)}`);
  const accepted = await nashC.client("POST", `/api/offers/${invite.data.offer.id}/accept`, {});
  if (accepted.status !== 201) throw new Error(`direct accept failed: ${JSON.stringify(accepted.data)}`);
  const solo = accepted.data.booking;
  check("booking +1: a solo booking carries no collab block", !solo.collab && !solo.collabRole, JSON.stringify(solo).slice(0, 160));
  const added = await nashC.client("POST", `/api/bookings/${solo.id}/plus-one`, { plusOneCreatorId: nashD.id });
  check("booking +1: the booked creator can add a +1 to a held visit",
    added.status === 201 && !!added.data.companion && added.data.companion.collabRole === "plusone" && !!added.data.booking.collab,
    JSON.stringify(added.data).slice(0, 240));
  const comp1 = added.data.companion;
  const bizDecline = await biz.client("POST", `/api/bookings/${solo.id}/plus-one/decline`, {});
  check("booking +1: the business can decline a booking's +1 and keep the visit",
    bizDecline.status === 200 && !bizDecline.data.booking.collab && bizDecline.data.booking.status === "booked",
    JSON.stringify(bizDecline.data).slice(0, 200));
  const dView1 = await nashD.client("GET", "/api/bookings");
  const dComp1 = (dView1.data.bookings || []).find((b) => b.id === comp1.id);
  check("booking +1: a declined companion is cancelled, not left hanging",
    !!dComp1 && dComp1.status === "cancelled", JSON.stringify(dComp1 && dComp1.status));
  const added2 = await nashC.client("POST", `/api/bookings/${solo.id}/plus-one`, { plusOneCreatorId: nashD.id });
  check("booking +1: a different (or the same) +1 can be added after a decline", added2.status === 201 && !!added2.data.companion, JSON.stringify(added2.data).slice(0, 160));
  const removed = await nashC.client("POST", `/api/bookings/${solo.id}/plus-one/remove`, {});
  check("booking +1: the booked creator can remove their +1",
    removed.status === 200 && !removed.data.booking.collab, JSON.stringify(removed.data).slice(0, 200));
  const dView2 = await nashD.client("GET", "/api/bookings");
  const dComp2 = (dView2.data.bookings || []).find((b) => b.id === added2.data.companion.id);
  check("booking +1: a removed companion is cancelled", !!dComp2 && dComp2.status === "cancelled", JSON.stringify(dComp2 && dComp2.status));

  // ---------- paid rule: the +1 on a paid booking is comped presence ----------
  await nashA.client("PATCH", "/api/me/profile", { paidRate: 200 });
  const paid = await biz.client("POST", "/api/bookings/paid", { creatorId: nashA.id });
  if (paid.status !== 201) throw new Error(`paid booking failed: ${JSON.stringify(paid.data)}`);
  check("paid: the primary booking is a real paid lane booking", !!paid.data.booking.paidLane && paid.data.booking.kind === "paid", JSON.stringify(paid.data.booking).slice(0, 200));
  const paidPlus = await nashA.client("POST", `/api/bookings/${paid.data.booking.id}/plus-one`, { plusOneCreatorId: nashB.id });
  check("paid: the +1 books as comped presence only (no second paid lane, no split)",
    paidPlus.status === 201 && !!paidPlus.data.companion && paidPlus.data.companion.kind === "comp" && !paidPlus.data.companion.paidLane && paidPlus.data.companion.collabCompedPresence === true && !!paidPlus.data.booking.collab && paidPlus.data.booking.collab.compedPresence === true,
    JSON.stringify(paidPlus.data).slice(0, 280));

  // ---------- cascade: giving the spot back takes the companion ----------
  const invite2 = await biz.client("POST", "/api/offers", { title: "Cascade Night", whatComped: "Dinner for two", dollarCap: 60, spots: 1, includesAlcohol: false, creatorId: nashD.id });
  const acc2 = await nashD.client("POST", `/api/offers/${invite2.data.offer.id}/accept`, { plusOneCreatorId: nashE.id });
  if (acc2.status !== 201) throw new Error(`cascade accept failed: ${JSON.stringify(acc2.data)}`);
  check("cascade: a direct accept can name its +1", !!acc2.data.booking.collab && acc2.data.booking.collab.creatorId === nashE.id, JSON.stringify(acc2.data.booking).slice(0, 200));
  const eView = await nashE.client("GET", "/api/bookings");
  const eComp = (eView.data.bookings || []).find((b) => b.collabPrimaryBookingId === acc2.data.booking.id);
  check("cascade: the companion exists before the give-back", !!eComp && eComp.status === "booked", JSON.stringify(eComp).slice(0, 160));
  // Give the spot back through the application decline path is
  // for selected applications; a direct-accept booking ends via
  // its own cancel routes — the companion must follow either
  // way. Here the +1 leaves first (their own door), then the
  // primary's visit stands solo.
  const left = await nashE.client("POST", `/api/bookings/${eComp.id}/plus-one/remove`, {});
  check("cascade: the +1 can leave their own spot", left.status === 200, JSON.stringify(left.data).slice(0, 160));
  const dView3 = await nashD.client("GET", "/api/bookings");
  const dPrimary3 = (dView3.data.bookings || []).find((b) => b.id === acc2.data.booking.id);
  check("cascade: after the +1 leaves, the primary visit stands solo",
    !!dPrimary3 && dPrimary3.status === "booked" && !dPrimary3.collab, JSON.stringify(dPrimary3).slice(0, 200));

  // ---------- cascade: giving a selected spot back cancels the companion ----------
  const offer2Res = await biz.client("POST", "/api/offers", { title: "Give Back Night", whatComped: "Dinner for two", includes: "Dinner for two", spots: 1, dollarCap: 100, covers: 2 });
  if (offer2Res.status !== 201) throw new Error(`give-back offer failed: ${JSON.stringify(offer2Res.data)}`);
  const applied2 = await nashC.client("POST", `/api/offers/${offer2Res.data.offer.id}/apply`, { plusOneCreatorId: nashD.id });
  if (applied2.status !== 201) throw new Error(`give-back apply failed: ${JSON.stringify(applied2.data)}`);
  const app2Id = applied2.data.application.id;
  const selected2 = await biz.client("POST", `/api/offers/${offer2Res.data.offer.id}/select`, { applicationId: app2Id });
  if (selected2.status !== 201) throw new Error(`give-back select failed: ${JSON.stringify(selected2.data)}`);
  const gaveBack = await nashC.client("POST", `/api/applications/${app2Id}/decline`, {});
  check("cascade: giving the spot back lands", gaveBack.status === 200, JSON.stringify(gaveBack.data).slice(0, 160));
  const dView4 = await nashD.client("GET", "/api/bookings");
  const dComp4 = (dView4.data.bookings || []).find((b) => b.collabPrimaryBookingId === selected2.data.booking.id);
  check("cascade: the companion is cancelled with the primary (a cancellation, never a no-show)",
    !!dComp4 && dComp4.status === "cancelled" && !(dComp4.compliance && dComp4.compliance.expiredAt),
    JSON.stringify(dComp4).slice(0, 200));

  // ---------- client + stamp (static) ----------
  const appSrc = readFileSync(join(ROOT, "public", "app.js"), "utf8");
  const buildJs = readFileSync(join(ROOT, "netlify", "functions", "lib", "build.js"), "utf8");
  const indexHtml = readFileSync(join(ROOT, "public", "index.html"), "utf8");
  check("client: Bench is a rail destination for live and founding creators",
    appSrc.includes('"Bench"') && appSrc.includes('label: "Bench"') && appSrc.includes('tab: "Bench"'), "");
  check("client: the +1 picker, pair block, and visibility toggle ship",
    appSrc.includes("poToggleHtml") && appSrc.includes("declinePairApplicant") && appSrc.includes("laneToggleCreators") && appSrc.includes("collabVisitHtml"), "");
  check("stamp: the build stamp is 2026.10.30-58 on server and shell",
    buildJs.includes('BUILD_ID = "2026.10.30-58"') && indexHtml.includes("2026.10.30-58"), "stamp mismatch");

  console.log(`\nverify-build42: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log(`FAILED: ${failures.join(" | ")}`); process.exitCode = 1; }
} catch (e) {
  console.error("verify-build42 crashed:", e);
  process.exitCode = 1;
} finally {
  if (server) { server.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); }
}
