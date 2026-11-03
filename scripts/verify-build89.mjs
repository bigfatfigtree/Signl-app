// Build -89 verification: London #ad disclosure + GBP creator money
// (Jeff, 2026-11-02, Tier 1 items 3+4).
// Pins:
//  - currency-by-market config: London GBP/£/£40 floor; others USD/$/$50.
//  - London briefs cannot lose #ad (server-enforced on create and patch);
//    US briefs untouched.
//  - London booking terms carry the ASA/CAP disclosure clause; US
//    bookings carry none.
//  - A London post without a verified #ad label is blocked from
//    delivered with the named "ad label missing" blocker (Build -57
//    owed pipeline); labelling it clears the blocker. US flow unchanged.
//  - London creator rate below £40 refused / £40 accepted; US $50
//    floor unchanged.
//  - London rate card / Sig answers render £; US renders $.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8963;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "adminpass123";
let passed = 0, failed = 0;
function check(name, cond, detail = "") { if (cond) { passed++; console.log(`ok   - ${name}`); } else { failed++; console.log(`FAIL - ${name} ${detail}`); } }
function part(t) { console.log(`\n== ${t} ==`); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b89-"));
const dbFile = path.join(tmp, "db.json");
fs.writeFileSync(dbFile, JSON.stringify({
  users: [{ id: "admin1", role: "admin", name: "Admin", email: ADMIN_EMAIL, passwordHash: null, password: ADMIN_PASSWORD, createdAt: new Date().toISOString() }],
  events: [], offers: [], bookings: [], posts: [], threads: [], messages: [], notifications: [], flags: [], payouts: [],
}, null, 1));
const server = spawn("node", [path.join(root, "scripts/dev-server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD, SIGNL_SKIP_DOTENV: "1", NETLIFY: "", CONTEXT: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}
function makeClient() {
  let cookie = "";
  const call = async (method, p, body) => {
    const res = await fetch(BASE + p, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
    const setc = res.headers.get("set-cookie");
    if (setc) cookie = setc.split(";")[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = { text }; }
    return { status: res.status, data, text };
  };
  call.raw = async (p) => { const res = await fetch(BASE + p); return { status: res.status, text: await res.text() }; };
  return call;
}
async function login(email, password) { const c = makeClient(); const r = await c("POST", "/api/auth/login", { email, password }); if (r.status !== 200) throw new Error("login " + email + " " + r.status); return c; }
const uniq = () => Math.random().toString(36).slice(2, 8);
async function registerCreator(overrides = {}) {
  const client = makeClient();
  const payload = {
    role: "creator", name: "B89 Creator", email: `c89-${uniq()}@fixtures.dev`, password: "password123",
    market: "London", city: "London", area: "Hackney", handle: `@c89${uniq()}`, primaryPlatform: "instagram",
    followerCount: 9000, categories: ["Food & Drink"], localAudiencePct: 70,
    bio: "London food creator.", agreedTerms: true, agreedEmailComms: true, agreedPostCompliance: true,
    ...overrides,
  };
  const r = await client("POST", "/api/auth/register", payload);
  return { client, res: r, user: r.data && r.data.user, payload };
}
async function registerBusiness(market, city, name) {
  const client = makeClient();
  const r = await client("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", email: `b89-${uniq()}@fixtures.dev`, password: "password123",
    market, city, businessName: name, category: "Restaurant", planId: "growth", agreedTerms: true,
  });
  return { client, res: r, user: r.data && r.data.user };
}
async function approve(admin, userId) { const r = await admin("POST", "/api/admin/review", { userId, decision: "approve" }); if (r.status !== 200) throw new Error("approve " + JSON.stringify(r.data)); }

try {
  await waitUp();
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const anon = makeClient();

  part("config: currency by market");
  const { currencyForMarket, paidFloorForMarket } = await import(path.join(root, "netlify/functions/lib/markets.js"));
  check("London config is GBP/£/floor 40", (() => { const c = currencyForMarket("London"); return c.code === "GBP" && c.symbol === "£" && c.paidFloor === 40 && paidFloorForMarket("London") === 40; })(), JSON.stringify(currencyForMarket("London")));
  check("Nashville config stays USD/$/floor 50", (() => { const c = currencyForMarket("Nashville"); return c.code === "USD" && c.symbol === "$" && paidFloorForMarket("Nashville") === 50; })(), JSON.stringify(currencyForMarket("Nashville")));

  part("config: Sig canon + client helpers");
  const { canonForMarket } = await import(path.join(root, "netlify/functions/lib/sigai.js"));
  check("London Sig canon quotes the £40 floor and the #ad rule", canonForMarket("London").includes("£40 floor") && canonForMarket("London").includes("#ad") && canonForMarket("London").includes("ASA"), "");
  check("US Sig canon is unchanged ($50 floor, no UK line)", canonForMarket("Nashville").includes("$50 floor") && !canonForMarket("Nashville").includes("ASA") && !canonForMarket("Nashville").includes("£"), "");
  const appJs = await anon.raw("/app.js");
  check("client ships market currency helpers + the London caption field", appJs.text.includes("currencySymbolForMarket") && appJs.text.includes("ownPaidFloor") && appJs.text.includes("post-caption-"), "");

  part("GBP floors: London creator patch + US control");
  const lc = await registerCreator({});
  await approve(admin, lc.user.id);
  const low = await lc.client("PATCH", "/api/me/profile", { paidRate: 39 });
  check("London paid rate £39 refused with the £40 floor named", low.status === 400 && /£40/.test(low.data.error || ""), `${low.status} ${JSON.stringify(low.data)}`);
  const at = await lc.client("PATCH", "/api/me/profile", { paidRate: 40 });
  check("London paid rate £40 accepted", at.status === 200 && at.data.user.creator.paidRate === 40, `${at.status}`);
  await lc.client("PATCH", "/api/me/profile", { paidRate: 150, licensingFee: 80 });
  const rr = await lc.client("GET", "/api/me/rate-range");
  check("London rate-range endpoint reports floor 40 in £", rr.status === 200 && rr.data.floor === 40 && rr.data.currencySymbol === "£" && rr.data.currency === "GBP", JSON.stringify(rr.data));
  const us = await registerCreator({ market: "Nashville", city: "Nashville", area: undefined, handle: `@us89${uniq()}` });
  await approve(admin, us.user.id);
  const usLow = await us.client("PATCH", "/api/me/profile", { paidRate: 49 });
  check("US paid rate $49 still refused with $50 named", usLow.status === 400 && /\$50/.test(usLow.data.error || ""), `${usLow.status} ${JSON.stringify(usLow.data)}`);
  const usOk = await us.client("PATCH", "/api/me/profile", { paidRate: 50 });
  check("US paid rate $50 accepted (unchanged)", usOk.status === 200 && usOk.data.user.creator.paidRate === 50, `${usOk.status}`);
  const rrUs = await us.client("GET", "/api/me/rate-range");
  check("US rate-range endpoint still floor 50 in $", rrUs.data.floor === 50 && rrUs.data.currencySymbol === "$", JSON.stringify(rrUs.data));

  part("Sig renders the creator's own currency");
  const sigRate = await lc.client("POST", "/api/sig/ask", { q: "what is my rate", history: [] });
  check("London Sig rate answer renders £ (£150 rate, £80 fee, 97% keep)", sigRate.status === 200 && (sigRate.data.text || "").includes("£150") && (sigRate.data.text || "").includes("£80") && (sigRate.data.text || "").includes("You keep 97%") && !(sigRate.data.text || "").includes("$"), JSON.stringify(sigRate.data).slice(0, 300));
  const sigEarn = await lc.client("POST", "/api/sig/ask", { q: "how much have i earned", history: [] });
  check("London Sig earnings answer renders £", (sigEarn.data.text || "").includes("Recorded: £0 net"), JSON.stringify(sigEarn.data).slice(0, 220));
  const sigUs = await us.client("POST", "/api/sig/ask", { q: "what is my rate", history: [] });
  check("US Sig rate answer still renders $ ($50 rate)", (sigUs.data.text || "").includes("$50") && !(sigUs.data.text || "").includes("£"), JSON.stringify(sigUs.data).slice(0, 220));

  part("London brief: #ad is server-enforced");
  const lb = await registerBusiness("London", "London", "Borough Bites");
  await approve(admin, lb.user.id);
  await admin("POST", "/api/admin/businesses/activate", { userId: lb.user.id });
  const offNoAd = await lb.client("POST", "/api/offers", { title: "Tasting night", whatComped: "Dinner for two", dollarCap: 90, spots: 1, creatorId: lc.user.id, brief: { mustMention: ["Try the tasting menu"] } });
  const mm1 = offNoAd.data.offer && offNoAd.data.offer.brief && offNoAd.data.offer.brief.mustMention || [];
  check("London brief created without #ad gets it forced in", offNoAd.status === 201 && mm1.includes("#ad"), `${offNoAd.status} ${JSON.stringify(mm1)}`);
  const offPatch = await lb.client("PATCH", `/api/offers/${offNoAd.data.offer.id}`, { brief: { mustMention: ["No disclosure please"] } });
  const mm2 = offPatch.data.offer && offPatch.data.offer.brief && offPatch.data.offer.brief.mustMention || [];
  check("London brief patch cannot remove #ad", offPatch.status === 200 && mm2.includes("#ad") && mm2.includes("No disclosure please"), `${offPatch.status} ${JSON.stringify(mm2)}`);
  const ub = await registerBusiness("Nashville", "Nashville", "Nashville Eats");
  await approve(admin, ub.user.id);
  await admin("POST", "/api/admin/businesses/activate", { userId: ub.user.id });
  const offUs = await ub.client("POST", "/api/offers", { title: "US tasting", whatComped: "Dinner for two", dollarCap: 90, spots: 1, creatorId: us.user.id, brief: { mustMention: ["Try the menu"] } });
  const mmUs = offUs.data.offer && offUs.data.offer.brief && offUs.data.offer.brief.mustMention || [];
  check("US brief keeps exactly what the business wrote (no #ad forced)", offUs.status === 201 && mmUs.length === 1 && mmUs[0] === "Try the menu", `${offUs.status} ${JSON.stringify(mmUs)}`);

  part("booking terms: London carries the clause, US does not");
  const acc = await lc.client("POST", `/api/offers/${offNoAd.data.offer.id}/accept`, { agreedVisitRules: true });
  const compBookingId = acc.data.booking && acc.data.booking.id;
  const myBookings = await lc.client("GET", "/api/bookings");
  const compBooking = (myBookings.data.bookings || []).find((b) => b.id === compBookingId);
  check("London comp booking terms carry the ASA/CAP #ad clause", !!compBooking && !!compBooking.adDisclosure && /ASA\/CAP/.test(compBooking.adDisclosure.clause) && compBooking.adDisclosure.label === "#ad", JSON.stringify(compBooking && compBooking.adDisclosure));
  const accUs = await us.client("POST", `/api/offers/${offUs.data.offer.id}/accept`, { agreedVisitRules: true });
  const usBookings = await us.client("GET", "/api/bookings");
  const usBooking = (usBookings.data.bookings || []).find((b) => b.id === (accUs.data.booking && accUs.data.booking.id));
  check("US booking carries no UK disclosure block", !!usBooking && !usBooking.adDisclosure, JSON.stringify(usBooking && usBooking.adDisclosure));

  part("paid booking + the ad-label delivery blocker");
  const pb = await lb.client("POST", "/api/bookings/paid", { creatorId: lc.user.id });
  check("London paid booking created with the clause on its terms", pb.status === 201 && !!pb.data.booking.adDisclosure && /ASA\/CAP/.test(pb.data.booking.adDisclosure.clause), `${pb.status} ${JSON.stringify(pb.data).slice(0, 240)}`);
  const pbId = pb.data.booking.id;
  const conf = await lb.client("POST", `/api/bookings/${pbId}/confirm`, {});
  check("London paid visit confirmed (redeemed)", conf.status === 200 && !!conf.data.booking.redeemedAt, `${conf.status}`);
  const postNoLabel = await lc.client("POST", "/api/posts", { bookingId: pbId, url: "https://www.instagram.com/p/b89nolabel/", includesDisclosure: true, caption: "Lovely dinner, thanks for having us" });
  check("London post without #ad in the caption is stored UNVERIFIED", postNoLabel.status === 201 && postNoLabel.data.post.adLabelVerified === false, `${postNoLabel.status} ${JSON.stringify(postNoLabel.data.post || {}).slice(0, 200)}`);
  const owed1 = await admin("GET", "/api/admin/command/owed");
  const held1 = ((owed1.data.creators || {}).held || []).find((h) => h.id === pbId);
  check("owed pipeline blocks the unlabelled London post: code ad_label_missing", !!held1 && held1.code === "ad_label_missing" && /Ad label missing/.test(held1.blocker || ""), JSON.stringify(held1));
  const postId = postNoLabel.data.post.id;
  const labelBad = await lc.client("POST", `/api/posts/${postId}/ad-label`, { caption: "still no label here" });
  check("ad-label endpoint refuses a caption without #ad", labelBad.status === 400 && /#ad/.test(labelBad.data.error || ""), `${labelBad.status} ${JSON.stringify(labelBad.data)}`);
  const labelOk = await lc.client("POST", `/api/posts/${postId}/ad-label`, { caption: "#ad — dinner on the house at Borough Bites" });
  check("ad-label endpoint verifies a caption carrying #ad up front", labelOk.status === 200 && labelOk.data.post.adLabelVerified === true, `${labelOk.status} ${JSON.stringify(labelOk.data).slice(0, 200)}`);
  const owed2 = await admin("GET", "/api/admin/command/owed");
  const held2 = ((owed2.data.creators || {}).held || []).find((h) => h.id === pbId);
  check("after labelling, the blocker clears (row leaves the ad_label_missing state)", !!held2 && held2.code !== "ad_label_missing", JSON.stringify(held2));
  const pbUs = await ub.client("POST", "/api/bookings/paid", { creatorId: us.user.id });
  const pbUsId = pbUs.data.booking.id;
  await ub.client("POST", `/api/bookings/${pbUsId}/confirm`, {});
  const postUs = await us.client("POST", "/api/posts", { bookingId: pbUsId, url: "https://www.instagram.com/p/b89uspost/", includesDisclosure: true });
  const owedUs = await admin("GET", "/api/admin/command/owed");
  const heldUs = ((owedUs.data.creators || {}).held || []).find((h) => h.id === pbUsId);
  check("US paid post with no caption flows as before (in the 48h hold, no ad blocker)", !!heldUs && heldUs.code === "in_hold", JSON.stringify(heldUs));

  console.log(`\nbuild89: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  fs.rmSync(tmp, { recursive: true, force: true });
}