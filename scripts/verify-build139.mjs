// Build -139 (post-138 fix batch) verification.
// Item 12 — test offers: the Admin seeder creates testOnly
//   offers from the Salt Line Test Kitchen test business, and
//   EVERY read surface fences them to tester-flagged creators.
// Item 13 — role welcome emails: recruiter creation sends the
//   dedicated recruiter_welcome kind (never password_reset),
//   and the welcome builders carry no "reset" wording in their
//   prose; the plain reset template is untouched.
// Item 10 — aggregate memo pins (store write version + memoAgg
//   wiring on the heavy admin reads).
// Run: node scripts/verify-build139.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
const recruitersJs = fs.readFileSync(path.join(root, "netlify/functions/lib/recruiters.js"), "utf8");
const pilotsJs = fs.readFileSync(path.join(root, "netlify/functions/lib/pilots.js"), "utf8");
const storeJs = fs.readFileSync(path.join(root, "netlify/functions/lib/store.js"), "utf8");
const catalogJs = fs.readFileSync(path.join(root, "netlify/functions/lib/automations-catalog.js"), "utf8");

let passed = 0, failed = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log("  ok:", name); }
  else { failed++; failures.push(name); console.log("FAIL:", name, detail ? `— ${detail}` : ""); }
}
const slice = (s, from, len) => { const i = s.indexOf(from); return i < 0 ? "" : s.slice(i, i + len); };

// ---------- Item 13 statics ----------
const rw = slice(routerJs, "function recruiterWelcomeEmail", 1200);
check("welcome: recruiter builder exists with Jeff's subject", rw.includes("You're a SIGNL recruiter") && rw.includes("tracked link") && rw.includes("credited to you"));
check("welcome: recruiter prose carries NO 'reset' wording (the link param is machinery, not copy)", !/reset/i.test(rw.replace("link", "")), rw.slice(0, 200));
const pw = slice(routerJs, "function partnerWelcomeEmail", 1200);
check("welcome: partner builder exists, names the role + the funding job", pw.includes("You're a SIGNL partner") && pw.includes("fund first visits") && !/reset/i.test(pw.replace("link", "")));
const twStart = routerJs.indexOf("function teamWelcomeEmail");
const tw = routerJs.slice(twStart, routerJs.indexOf("\n}\n", twStart) + 3);
check("welcome: team builder exists, names the seat's role via rolePhrase", tw.includes("You've been invited to SIGNL") && tw.includes("rolePhrase") && !/reset/i.test(tw.replace("link", "")));
check("welcome: the plain reset template is UNTOUCHED for real forgot-password", routerJs.includes("Reset your SIGNL password") && routerJs.includes("We got a request to reset the password on your SIGNL account."));
check("welcome: recruiters invite + resend send the recruiter_welcome kind when the builder is wired",
  (recruitersJs.match(/recruiter_welcome/g) || []).length >= 2 && recruitersJs.includes("deps.recruiterWelcomeEmail"));
check("welcome: pilot partner invite + resend send the partner_welcome kind", (pilotsJs.match(/partner_welcome/g) || []).length >= 2 && pilotsJs.includes("deps.partnerWelcomeEmail"));
check("welcome: seat invites send team_welcome via sendSeatInviteEmail", routerJs.includes('deliverEmail("team_welcome"') && routerJs.includes("function teamWelcomeEmail"));
check("welcome: all three kinds are critical entries in the automations catalogue",
  catalogJs.includes('kind: "recruiter_welcome"') && catalogJs.includes('kind: "partner_welcome"') && catalogJs.includes('kind: "team_welcome"'));

// ---------- Item 12 statics ----------
check("test offers: seeder + status + admin routes exist", routerJs.includes("async function seedTestOffers") && routerJs.includes("testOffersStatus") && routerJs.includes('seg[1] === "test-offers"'));
check("test offers: the three seeded offers match Jeff's spec (comp $120 for two / paid $100 + lunch $60 / $100 store credit)",
  routerJs.includes("Dinner for two on us: try the new fall menu") && routerJs.includes("Paid visit: Saturday lunch feature") && routerJs.includes("Lunch covered up to $60") && routerJs.includes("$100 store credit: come hungry, order anything") && routerJs.includes('type: "store_credit", amount: 100'));
check("test offers: deterministic ids make loading idempotent", routerJs.includes("test-offer-${spec.key}") && routerJs.includes("if (await store.get(`offer:${offer.id}`))"));
check("test offers: board fence — non-testers skip testOnly before any other board logic", routerJs.includes("if (o.testOnly && !isTester(user)) continue;"));
check("test offers: feed + Sig counts + apply all fence testOnly", (routerJs.match(/!o\.testOnly \|\| isTester\(user\)/g) || []).length >= 4 && routerJs.includes('if (offer.testOnly && !isTester(user)) return err(404, "Offer not available")'));
check("test offers: Admin panel sits beside the demo showcase panel", appJs.includes('id="admin-test-offers"') && appJs.includes("function adminTestOffersLoad") && appJs.includes('api("POST", "/admin/test-offers/load"'));

// ---------- Item 10 statics ----------
check("speed: store exposes a write version and both backends bump it", storeJs.includes("module.exports.version") && (storeJs.match(/bumpVersion\(\)/g) || []).length >= 4);
check("speed: the heavy admin reads (markets, platform totals, applications) ride the version-guarded memo",
  routerJs.includes("function memoAgg") && routerJs.includes("aggMemoGet") && routerJs.includes("admin-markets:") && routerJs.includes("platform-totals:") && routerJs.includes("admin-applications:"));

// ---------- HTTP: the fence, end to end ----------
const PORT = 9019;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b139.dev";
const ADMIN_PW = "verify-build139-pass";
const PW = "fixture-pass-139";
const salt = "b139fixturesalt";
const hash = crypto.scryptSync(PW, salt, 64).toString("hex");
const now0 = Date.now();
const iso = (t) => new Date(t).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const creatorShape = (id, email, handle, extra) => ({ id, role: "creator", email, name: handle === "realnash" ? "Rita Real" : "Tess Tester", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0), updatedAt: iso(now0),
  creator: { handle, primaryPlatform: "instagram", followerCount: 8000, totalAudience: 8000, audienceStack: { instagram: 8000 }, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], localAudiencePct: 80, tierBand: "Locals", profileComplete: true, publicPage: true, hasPhoto: false, bio: "", zip: "37201", compOpen: true, couponOpen: true, paidRate: 150 }, ...extra });
putUser({ id: "bizSalt", role: "business", email: "saltline@b139.dev", name: "Salt Line Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", tester: true, createdAt: iso(now0), updatedAt: iso(now0),
  business: { businessName: "Salt Line Test Kitchen", category: "Restaurant", plan: "self-service", planId: "self-service", about: "Test kitchen.", neighborhood: "Downtown", zip: "37201" } });
putUser(creatorShape("crTester", "hello@xmedium.co", "testernash", { tester: true }));
putUser(creatorShape("crWjr", "wjrimmer@gmail.com", "wjtester", { tester: true }));
putUser(creatorShape("crReal", "real@b139.dev", "realnash", {}));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-b139-"));
const dbPath = path.join(tmp, "db.json");
fs.writeFileSync(dbPath, JSON.stringify(data));
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbPath, SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD: ADMIN_PW, SIGNL_TEST_ALLOW_BUSINESS: "1" };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: "ignore" });

function client() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) { const m = setCookie.match(/^([^=]+)=([^;]*)/); if (m) jar.set(m[1], m[2]); }
    const text = await res.text();
    let d = null;
    try { d = JSON.parse(text); } catch (e) { /* html */ }
    return { status: res.status, data: d, text };
  };
}

try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { const r = await fetch(BASE + "/api/bootstrap"); up = r.status > 0; } catch (e) { await new Promise((r) => setTimeout(r, 250)); }
  }
  check("dev server boots", up);

  const admin = client();
  const alogin = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PW });
  check("admin logs in", alogin.status === 200, String(alogin.status));

  const load1 = await admin("POST", "/api/admin/test-offers/load", {});
  check("seeder: load succeeds from the Salt Line test business", load1.status === 200 && load1.data.result && load1.data.result.businessName === "Salt Line Test Kitchen", JSON.stringify(load1.data).slice(0, 200));
  check("seeder: 3 open + 6 direct clones created (2 tester creators addressed)", load1.data && load1.data.result && load1.data.result.created === 9, JSON.stringify(load1.data && load1.data.result));
  check("seeder: direct clones addressed to both of Jeff's tester creators", load1.data && load1.data.result && (load1.data.result.directFor || []).includes("hello@xmedium.co") && load1.data.result.directFor.includes("wjrimmer@gmail.com"));
  const load2 = await admin("POST", "/api/admin/test-offers/load", {});
  check("seeder: loading twice does not duplicate (idempotent)", load2.status === 200 && load2.data.result.created === 0 && load2.data.result.existing === 9, JSON.stringify(load2.data && load2.data.result));
  const status = await admin("GET", "/api/admin/test-offers");
  check("seeder: status reports 9 loaded (3 open-lane, 6 direct)", status.data && status.data.testOffers && status.data.testOffers.loaded === 9 && status.data.testOffers.openLane === 3 && status.data.testOffers.direct === 6, JSON.stringify(status.data));

  const ct = client();
  check("tester creator logs in", (await ct("POST", "/api/auth/login", { email: "hello@xmedium.co", password: PW })).status === 200);
  const board = await ct("GET", "/api/open-offers");
  const titles = (board.data.offers || []).map((o) => o.title);
  check("board: tester creator sees exactly the 3 test offers", titles.length === 3 && titles.some((t) => t.includes("Dinner for two")) && titles.some((t) => t.includes("Saturday lunch")) && titles.some((t) => t.includes("store credit")), titles.join(" | "));
  const kinds = (board.data.offers || []).map((o) => o.kind).sort();
  check("board: the 3 kinds are comp / paid / coupon", JSON.stringify(kinds) === JSON.stringify(["comp", "coupon", "paid"]), kinds.join(","));
  const feed = await ct("GET", "/api/offers");
  const direct = (feed.data.offers || []).filter((o) => o.lane === "direct" && o.testOnly);
  check("feed: tester's My offers carries the 3 direct clones", direct.length === 3 && direct.every((o) => o.creatorId === "crTester"), JSON.stringify((feed.data.offers || []).map((o) => o.id)));

  const cr = client();
  check("real creator logs in", (await cr("POST", "/api/auth/login", { email: "real@b139.dev", password: PW })).status === 200);
  const boardReal = await cr("GET", "/api/open-offers");
  check("board: a real (non-tester) creator sees NONE of the test offers", (boardReal.data.offers || []).length === 0, JSON.stringify((boardReal.data.offers || []).map((o) => o.title)));
  const feedReal = await cr("GET", "/api/offers");
  check("feed: a real creator's /offers carries no testOnly offers", (feedReal.data.offers || []).filter((o) => o.testOnly).length === 0);
  const applyReal = await cr("POST", "/api/offers/test-offer-comp/apply", {});
  check("apply: a real creator cannot apply around the fence (404)", applyReal.status === 404, String(applyReal.status));

  // Recruiter invite — the welcome kind, not password_reset.
  const inv = await admin("POST", "/api/admin/recruiters/invite", { name: "Rae Recruiter", email: "rae@b139.dev", market: "Nashville" });
  check("recruiter invite succeeds with the welcome sent", inv.status === 200 && inv.data.emailSent === true, JSON.stringify(inv.data).slice(0, 200));
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const events = Object.values(db).filter((v) => v && typeof v === "object" && v.type);
  const welcomeEv = events.find((e) => e.type === "recruiter_welcome_email_sent" && e.data && e.data.to === "rae@b139.dev");
  check("recruiter invite fired the recruiter_welcome kind with Jeff's subject", !!welcomeEv && welcomeEv.data.subject === "You're a SIGNL recruiter", JSON.stringify(events.filter((e) => /_email_sent/.test(e.type)).map((e) => e.type)));
  const resetEv = events.find((e) => e.type === "password_reset_email_sent" && e.data && e.data.to === "rae@b139.dev");
  check("recruiter invite fired NO password_reset mail", !resetEv);
  const dbText = JSON.stringify(db);
  check("no notification of any kind went to the real creator about test offers", !events.some((e) => e.subjectId === "crReal" && /offer/.test(e.type || "")));
  check("seeded offers are stamped testOnly in the store", dbText.includes('"testOnly":true'));
} finally {
  server.kill();
}

console.log(`\nBuild -139 verify: ${passed} passed, ${failed} failed`);
if (failed) { console.error("Failures:", failures.join(" | ")); process.exit(1); }
