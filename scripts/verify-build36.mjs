#!/usr/bin/env node
// Build 2026.10.29-36 verification: Points and Your Line.
// Points = Momentum (existing table) + invite points from Your
// Line: gen 1 = 100, gen 2 = 25, gen 3 = 10, nothing beyond,
// and ONLY when the invited creator has FINISHED (approved +
// complete profile). Levels are a plain ladder whose perks
// open offers early; total points order the Local List within
// a market. A language scan keeps MLM vocabulary out of the
// product entirely.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8946;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "build36-admin@signl.local";
const ADMIN_PASSWORD = ["build36", "admin", "pass"].join("-");

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} :: ${detail}`); }
}

function client() {
  const jar = new Map();
  return async (method, path, body) => {
    const headers = { "content-type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const part of setCookie.split(/,(?=[^;]+?=)/)) { const m = part.match(/^\s*([^=]+)=([^;]*)/); if (m) jar.set(m[1], m[2]); }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

async function waitUp() {
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.status) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}

async function registerCreator(c, admin, { name, email, handle, referredBy = null, approve = true }) {
  const reg = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle, followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"],
    ...(referredBy ? { referredBy } : {}),
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (reg.status !== 201) throw new Error(`creator ${handle} failed: ${JSON.stringify(reg.data)}`);
  if (approve) await admin("POST", "/api/admin/review", { userId: reg.data.user.id, decision: "approve" });
  await c("PATCH", "/api/me/profile", { publicPage: true });
  return { client: c, id: reg.data.user.id, handle };
}

let server;
try {
  const dir = mkdtempSync(join(tmpdir(), "signl-build36-"));
  const dbPath = join(dir, "db.json");
  server = spawn(process.execPath, ["scripts/dev-server.mjs", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbPath, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitUp();

  const admin = client();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (login.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(login.data)}`);
  await admin("POST", "/api/admin/markets/toggle", { market: "Richmond", live: true });

  // The line: Rosa -> Lina -> Gino -> Trey -> Quad.
  const rosa = await registerCreator(client(), admin, { name: "Root Rosa", email: "rosa@fixtures.dev", handle: "rootrosa" });
  const linaPending = client();
  const linaReg = await linaPending("POST", "/api/auth/register", {
    role: "creator", name: "Line Lina", email: "lina@fixtures.dev", password: "creator-pass-123", market: "Richmond", city: "Richmond",
    handle: "linaline", followerCount: 3200, localAudiencePct: 82, categories: ["Food & Drink"], referredBy: "rootrosa",
    agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (linaReg.status !== 201) throw new Error(`lina register failed: ${JSON.stringify(linaReg.data)}`);
  const beforeFinish = await rosa.client("GET", "/api/me/points");
  check("points land only on FINISH: an invited creator who has not finished earns the inviter nothing",
    beforeFinish.status === 200 && beforeFinish.data.linePoints === 0 && beforeFinish.data.byGeneration[0].count === 0,
    JSON.stringify(beforeFinish.data).slice(0, 220));
  await admin("POST", "/api/admin/review", { userId: linaReg.data.user.id, decision: "approve" });
  const lina = { client: linaPending, id: linaReg.data.user.id, handle: "linaline" };
  const afterG1 = await rosa.client("GET", "/api/me/points");
  check("generation 1 pays the full 100 when the invite finishes",
    afterG1.data.linePoints === 100 && afterG1.data.byGeneration[0].count === 1 && afterG1.data.byGeneration[0].points === 100,
    JSON.stringify(afterG1.data).slice(0, 220));
  check("the total is Momentum plus Line, stated in parts",
    afterG1.data.total === afterG1.data.momentumPoints + afterG1.data.linePoints, JSON.stringify(afterG1.data).slice(0, 200));

  const gino = await registerCreator(client(), admin, { name: "Gen Gino", email: "gino@fixtures.dev", handle: "ginogen2", referredBy: "linaline" });
  const afterG2 = await rosa.client("GET", "/api/me/points");
  check("generation 2 pays 25 to the root inviter",
    afterG2.data.linePoints === 125 && afterG2.data.byGeneration[1].count === 1 && afterG2.data.byGeneration[1].points === 25,
    JSON.stringify(afterG2.data).slice(0, 220));
  const trey = await registerCreator(client(), admin, { name: "Third Trey", email: "trey@fixtures.dev", handle: "treygen3", referredBy: "ginogen2" });
  const afterG3 = await rosa.client("GET", "/api/me/points");
  check("generation 3 pays 10 to the root inviter",
    afterG3.data.linePoints === 135 && afterG3.data.byGeneration[2].count === 1 && afterG3.data.byGeneration[2].points === 10,
    JSON.stringify(afterG3.data).slice(0, 220));
  const quad = await registerCreator(client(), admin, { name: "Quad Four", email: "quad@fixtures.dev", handle: "quadgen4", referredBy: "treygen3" });
  const afterG4 = await rosa.client("GET", "/api/me/points");
  check("nothing is paid beyond generation 3",
    afterG4.data.linePoints === 135, JSON.stringify(afterG4.data).slice(0, 200));
  const treyPts = await trey.client("GET", "/api/me/points");
  check("every creator's own line starts at their own invites (Trey: Quad finished = 100)",
    treyPts.data.linePoints === 100, JSON.stringify(treyPts.data).slice(0, 200));

  // Levels: a fresh creator sits at Level 1 with no early
  // access; eight more finishers carry Rosa past the top
  // threshold on line points alone.
  const quadPts = await quad.client("GET", "/api/me/points");
  check("a new creator is Level 1 (Starter) with no early access",
    quadPts.data.level.level === 1 && quadPts.data.level.name === "Starter" && quadPts.data.level.earlyAccessHours === 0,
    JSON.stringify(quadPts.data.level));
  check("level thresholds are consistent: at <= total < nextAt",
    quadPts.data.level.at <= quadPts.data.total && (quadPts.data.level.nextAt === null || quadPts.data.total < quadPts.data.level.nextAt),
    JSON.stringify(quadPts.data.level) + " total=" + quadPts.data.total);
  for (let i = 1; i <= 8; i += 1) {
    await registerCreator(client(), admin, { name: `Fin ${i}`, email: `fin${i}@fixtures.dev`, handle: `finisher${i}`, referredBy: "rootrosa" });
  }
  const rosaTop = await rosa.client("GET", "/api/me/points");
  check("eight more finished invites put Rosa at the top level on line points alone (935)",
    rosaTop.data.linePoints === 935 && rosaTop.data.level.level === 4 && rosaTop.data.level.name === "Cornerstone" && rosaTop.data.level.earlyAccessHours === 24,
    JSON.stringify({ line: rosaTop.data.linePoints, level: rosaTop.data.level }).slice(0, 220));
  const linaPts = await lina.client("GET", "/api/me/points");
  check("Lina's line reads 135 (Gino 100, Trey 25, Quad 10)",
    linaPts.data.linePoints === 135, JSON.stringify(linaPts.data).slice(0, 200));

  // Early access end to end: a fresh open offer is visible to
  // the top level at once and still closed to Level 1.
  const bizC = client();
  const bizReg = await bizC("POST", "/api/auth/register", {
    role: "business", name: "Biz Owner", businessName: "Points Kitchen", email: "biz@points.dev",
    password: "business-pass-123", market: "Richmond", city: "Richmond", category: "Restaurant", planId: "growth",
    neighborhood: "Carytown", agreedTerms: true,
  });
  if (bizReg.status !== 201) throw new Error(`business failed: ${JSON.stringify(bizReg.data)}`);
  await admin("POST", "/api/admin/review", { userId: bizReg.data.user.id, decision: "approve" });
  await admin("POST", "/api/admin/businesses/activate", { userId: bizReg.data.user.id });
  const offer = await bizC("POST", "/api/offers", { title: "Points Night", whatComped: "Dinner for two", dollarCap: 60, spots: 2 });
  if (offer.status !== 201) throw new Error(`offer failed: ${JSON.stringify(offer.data)}`);
  const rosaApply = await rosa.client("POST", `/api/offers/${offer.data.offer.id}/apply`, {});
  check("the top level applies inside the early window (24 hours early)",
    rosaApply.status === 201, `${rosaApply.status} ${JSON.stringify(rosaApply.data).slice(0, 160)}`);
  const quadApply = await quad.client("POST", `/api/offers/${offer.data.offer.id}/apply`, {});
  check("Level 1 waits for the public window on the same offer",
    quadApply.status !== 201, `${quadApply.status} ${JSON.stringify(quadApply.data).slice(0, 160)}`);

  // Local List ordering: same local reach, points decide.
  const list = await client()("GET", "/api/public/local-list?market=Richmond");
  const food = list.data && (list.data.categories || []).find((c) => c.name === "Food & Drink");
  const handles = food ? food.creators.map((c) => c.handle) : [];
  check("the Local List orders by points within the same local reach",
    handles.indexOf("rootrosa") > -1 && handles.indexOf("quadgen4") > -1 && handles.indexOf("rootrosa") < handles.indexOf("quadgen4"),
    handles.join(","));
  const rosaEntry = food && food.creators.find((c) => c.handle === "rootrosa");
  check("the level badge rides the Local List entry (top level)",
    !!rosaEntry && rosaEntry.level === 4 && rosaEntry.levelName === "Cornerstone", JSON.stringify(rosaEntry));

  // Admin line tree.
  const lineAdmin = await admin("GET", `/api/admin/line/${rosa.id}`);
  check("Admin sees the line tree with points by generation",
    lineAdmin.status === 200 && lineAdmin.data.generations[0].members.length === 9 && lineAdmin.data.generations[1].members.length === 1 && lineAdmin.data.generations[2].members.length === 1 && lineAdmin.data.linePoints === 935,
    JSON.stringify(lineAdmin.data).slice(0, 300));
  const lineByHandle = await admin("GET", "/api/admin/line/rootrosa");
  check("the line lookup also resolves a creator handle (the Admin Stats box)",
    lineByHandle.status === 200 && lineByHandle.data.creator.handle === "rootrosa", `${lineByHandle.status}`);
  const lineDenied = await rosa.client("GET", `/api/admin/line/${rosa.id}`);
  check("the line tree is Admin only", lineDenied.status === 403 || lineDenied.status === 404, String(lineDenied.status));

  // Book-me badge: Rosa's stamped top level shows publicly.
  const bookMe = await client()("GET", "/api/c/rootrosa");
  check("the level badge rides the book-me payload at Level 2 and up",
    bookMe.status === 200 && bookMe.data.profile && bookMe.data.profile.levelBadge && bookMe.data.profile.levelBadge.level === 4,
    JSON.stringify(bookMe.data && bookMe.data.profile && bookMe.data.profile.levelBadge));

  // Language scan: the banned vocabulary appears nowhere in
  // the product surfaces.
  const appJs = readFileSync(join(ROOT, "public/app.js"), "utf8");
  const routerJs = readFileSync(join(ROOT, "netlify/functions/lib/router.js"), "utf8");
  const banned = ["downline", "upline", "team volume", "multi-level", "multilevel", "MLM", "pyramid"];
  const hits = banned.filter((w) => appJs.includes(w) || routerJs.includes(w));
  check("no MLM vocabulary anywhere in the app or the API", hits.length === 0, hits.join(","));
  check("client: the Points and Your Line section ships on the founding home",
    appJs.includes("Points and Your Line") && appJs.includes("pointsSectionHtml") && appJs.includes("Ways to earn") && appJs.includes("/api/me/points"), "missing points UI");
  check("client: the level badge renders with its early-access perk",
    appJs.includes("levelBadge") && appJs.includes("Sees new offers"), "missing badge render");
  check("client: the Admin line lookup ships in Stats",
    appJs.includes("Your Line lookup") && appJs.includes("adminLineLookup"), "missing admin line UI");
} catch (e) {
  failures.push(`suite crashed: ${e.message}`);
  console.error(e);
} finally {
  if (server) server.kill("SIGTERM");
}

console.log(`\nverify-build36: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
