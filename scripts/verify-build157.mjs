// verify-build157.mjs — Build -157 Phase B: the seller system,
//     finished. Phase A (research) loaded the enrichment +
//     playbooks; Phase B wires them into the app:
//   ENRICH: the one-time loader merges ONLY the fields Phase A
//     verified (emails, phones, Instagrams, named owners), sets
//     Verify on new phone conflicts, parks the research notes in
//     an HQ-only field the rep payload never carries, attaches a
//     per-lead playbook, and stores Jeff's 10 pre-warm drafts in
//     Jeff's lane only (never in any rep payload, never sendable
//     from the app).
//   STATUS: the official per-lead status (Not contacted ·
//     Contacted · Meeting set · Follow up · Declined · Closed)
//     rides the same lead record + history system as the stages;
//     the stage machine is untouched.
//   SIDE-HUSTLE: the priority queue ("Your next best doors"),
//     on-demand trip clusters, gentle follow-up alarms, and the
//     Monday scoreboard (sweep + lazy Monday generation).
//   PREVIEW: "See Tony's view" — Jeff walks the rep's real
//     screens read-only; capture side-effects (visit logs,
//     claims, price-shown, stage changes) are suppressed.
//   NAV: Biz Dev joins the Admin Everything panel + hamburger,
//     Messages joins the hamburger (Jeff, 2026-11-09, approved).
//   Payments stay OFF the whole time.
// Run: node scripts/verify-build157.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB_PATH = path.join(os.tmpdir(), `signl-verify-build157-${Date.now()}.json`);
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB_PATH;
process.env.ADMIN_EMAIL = "jeff@joinsignl.com";
process.env.ADMIN_PASSWORD = ["fixture", "admin", "1"].join("-");
process.env.APP_URL = "http://localhost";
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
fs.writeFileSync(DB_PATH, "{}");

const require = createRequire(import.meta.url);
const store = require("../netlify/functions/lib/store.js");
const { handler } = require("../netlify/functions/api.js");
const root = path.join(process.cwd());

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

function makeClient() {
  const jar = new Map();
  return async function api(method, p, body, rawPath) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const url = new URL(p, "http://localhost");
    const res = await handler({
      httpMethod: method,
      path: rawPath || url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body === undefined ? null : JSON.stringify(body),
      isBase64Encoded: false,
    });
    const sc = res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"]);
    if (sc) for (const piece of String(sc).split(/,(?=[^;]+=)/)) { const m = piece.trim().match(/^([^=]+)=([^;]*)/); if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); } }
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = res.body; }
    return { status: res.statusCode, data };
  };
}

const PW = "fixture-password-1";
const uniq = () => Math.random().toString(36).slice(2, 9);
const dayStr = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => dayStr(new Date(Date.now() + n * 86400000));
const admin = makeClient();
{
  const r = await admin("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin login succeeds", r.status === 200, `got ${r.status}`);
}
const anon = makeClient();

async function registerCreator(name, handle, market, opts) {
  const o = opts || {};
  const c = makeClient();
  const email = o.email || `${handle.replace(/[^a-z0-9]/gi, "")}-${uniq()}@fixtures.dev`;
  const r = await c("POST", "/api/auth/register", {
    role: "creator", name, email, password: PW, market, city: o.city || market, handle,
    categories: o.categories || ["Food & Drink"], compCategories: ["Restaurant meals"], tierBand: "Locals",
    followerCount: o.followers || 5000, avgViews: 1500, localAudiencePct: o.pct == null ? 70 : o.pct,
    bio: "Fixture creator.", agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true,
  });
  if (r.status !== 201) throw new Error("creator register failed: " + JSON.stringify(r.data));
  return { client: c, email, id: r.data.user.id, handle };
}
async function approve(id) {
  const r = await admin("POST", "/api/admin/review", { userId: id, decision: "approve" });
  if (r.status !== 200) throw new Error("approve failed: " + JSON.stringify(r.data));
}
async function setTester(id) {
  const u = await store.get(`user:${id}`);
  u.tester = true;
  await store.set(`user:${id}`, u);
}

// --- A: source pins ------------------------------------------
console.log("== A: source pins ==");
{
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const bizJs = fs.readFileSync(path.join(root, "netlify/functions/lib/bizdev.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  check("stamp 2026.11.09-157 on both asset URLs", (indexHtml.match(/2026\.11\.09-157/g) || []).length === 2, `count=${(indexHtml.match(/2026\.11\.09-157/g) || []).length}`);
  check("enrichment data file ships in the function bundle", fs.existsSync(path.join(root, "netlify/functions/lib/bizdev-enrich-hr-157.json")), "");
  check("server carries the loader, statuses, queue, sweep, preview", bizJs.includes("maybeEnrich157") && bizJs.includes("runBizdevSweep") && bizJs.includes('"Meeting set"') && bizJs.includes("preview") && bizJs.includes("statusHistory"), "");
  check("router wires the enrichment pass + the bizdev sweep route", routerJs.includes("maybeEnrich157") && routerJs.includes("runBizdevSweep"), "");
  check("the daily bizdev sweep function exists on a schedule", (() => { try { const s = fs.readFileSync(path.join(root, "netlify/functions/bizdev-sweep.mjs"), "utf8"); return s.includes("schedule") && s.includes("/api/admin/bdev/sweep"); } catch (e) { return false; } })(), "");
  check("RULING 3 still holds: no spot-number copy in the bizdev module or client", !/You're #|You are #/.test(bizJs) && !/You're #/.test(appJs), "");
  check("RULING 4 still holds: no response-time promise anywhere new", !/15 minutes|15-minute/.test(bizJs), "");
  // Nav parity, source level (render-level is verify-navparity + QA):
  const evWin = appJs.slice(appJs.indexOf("function everythingGroups125("), appJs.indexOf("function openEverything125("));
  const hamFull = appJs.slice(appJs.indexOf("function hamburgerGroups137("), appJs.indexOf("function hamburgerRowHtml137("));
  const hamWin = hamFull.slice(hamFull.indexOf('u.role === "admin"')); // admin branch only — other roles carry their own Messages rows
  const evMsg = evWin.indexOf('"Messages"'), evBd = evWin.indexOf('"Biz Dev"');
  check("Everything panel: Biz Dev row sits right after Messages (rail order)", evMsg > -1 && evBd > evMsg && evWin.slice(evMsg, evBd).length < 400, `msg@${evMsg} bd@${evBd}`);
  const hamReq = hamWin.indexOf('"Requests"'), hamMsg = hamWin.indexOf('"Messages"'), hamBd = hamWin.indexOf('"Biz Dev"');
  check("hamburger: Messages + Biz Dev rows join Review & people, in rail order", hamReq > -1 && hamMsg > hamReq && hamBd > hamMsg, `req@${hamReq} msg@${hamMsg} bd@${hamBd}`);
  check("client carries the playbook, practice, queue and preview surfaces", appJs.includes("Your next best doors") && appJs.includes("bdPracticePick") && appJs.includes("abdPreviewOpen") && appJs.includes("Your playbook for this visit") && appJs.includes("BD_PREVIEW"), "");
}

// --- Cast ------------------------------------------------------
console.log("== Cast ==");
const TONY = await registerCreator("Tony Johnson", "tonyjohnson374", "Virginia Beach", { email: "tjohnson23462@gmail.com", city: "Newport News", categories: ["Lifestyle"], pct: 40, followers: 600 });
await approve(TONY.id);
await setTester(TONY.id);
const KESHA = await registerCreator("Kesha Vue", "vibewithkesha", "Virginia Beach", { categories: ["Food & Drink"], pct: 82, followers: 9000 });
await approve(KESHA.id);
const BELLA = await registerCreator("Bella Beauty", "bellabeauty757", "Virginia Beach", { categories: ["Beauty & Grooming"], pct: 65, followers: 4000 });
await approve(BELLA.id);
const NOSEAT = await registerCreator("Nina Noseat", "ninanoseat", "Nashville", { pct: 70, followers: 2000 });
await approve(NOSEAT.id);
await anon("GET", "/api/bootstrap");
const tonyLogin = await TONY.client("POST", "/api/auth/login", { email: "tjohnson23462@gmail.com", password: PW });
check("tony logs in", tonyLogin.status === 200, `got ${tonyLogin.status}`);

// The enrichment pass runs best-effort on the request path; poll
// the Terrapin detail until its playbook lands.
let terrapinId, heirloomId, castrosId, codexId, blueId, dupreId;
let terrapinDetail = null;
{
  const leads = await TONY.client("GET", "/api/bdev/leads");
  check("the book still holds exactly the 32 stored HR targets", leads.data.leads.length === 32, `got ${leads.data.leads.length}`);
  const byName = (n) => leads.data.leads.find((l) => l.name === n);
  terrapinId = byName("Terrapin Restaurant").id;
  heirloomId = byName("Heirloom").id;
  castrosId = byName("Castros V Barber Shop").id;
  codexId = byName("Codex").id;
  blueId = byName("Blue Seafood & Spirits").id;
  dupreId = byName("Dupre's Salon and Day Spa").id;
  for (let i = 0; i < 8 && !terrapinDetail; i++) {
    const d = await TONY.client("GET", `/api/bdev/leads/${terrapinId}`);
    if (d.data.lead && d.data.lead.playbook) terrapinDetail = d.data.lead;
    else await new Promise((r) => setTimeout(r, 250));
  }
}

// --- B: enrichment ----------------------------------------------
console.log("== B: enrichment + playbooks ==");
{
  check("the enrichment pass landed (Terrapin carries a playbook)", !!terrapinDetail, "");
  const pb = (terrapinDetail && terrapinDetail.playbook) || {};
  check("playbook: intro + follow-up emails are send-ready", !!(pb.introEmail && /Terrapin/.test(pb.introEmail.subject || "") && pb.followupEmail && (pb.followupEmail.body || "").length > 40), "");
  check("playbook: phone script has owner / staff / voicemail branches", !!(pb.phone && pb.phone.owner && pb.phone.staff && pb.phone.voicemail), "");
  check("playbook: run-sheet walks the Show Mode screens", Array.isArray(pb.runsheet) && pb.runsheet.length === 9 && pb.runsheet.every((s) => s.screen && s.say), `len=${(pb.runsheet || []).length}`);
  check("the rep payload never carries HQ research notes", terrapinDetail && !("hqResearch" in terrapinDetail), "");
  const leads = await TONY.client("GET", "/api/bdev/leads");
  check("enrichment lifts the book to 24 verified emails (15 seed + 9 found)", leads.data.leads.filter((l) => l.email).length === 24, `got ${leads.data.leads.filter((l) => l.email).length}`);
  const blue = leads.data.leads.find((l) => l.id === blueId);
  check("Blue Seafood's own published email merged", !!blue && blue.email === "help@blueseafoodandspirits.com", blue && blue.email);
  const casaDetail = await admin("GET", "/api/admin/bdev/leads");
  const casa = (casaDetail.data.leads || []).find((l) => l.name === "Casa Contour Medspa and Wellness");
  check("a NEW phone conflict arrives with Verify Before Use set (Casa Contour)", !!casa && casa.phoneVerify === true, "");
  const crudo = (casaDetail.data.leads || []).find((l) => l.name === "crudo nudo");
  check("HQ research notes live on the admin payload only (crudo fire note)", !!crudo && !!crudo.hqResearch && /fire/i.test(JSON.stringify(crudo.hqResearch)), "");
  check("admin payload flags which leads carry a playbook", !!crudo && crudo.hasPlaybook === true, "");
  const ov = await admin("GET", "/api/admin/bdev/overview");
  check("Jeff's pre-warm drafts are in his view (10, Terrapin addressed to Rodney)", (ov.data.prewarm || []).length === 10 && (ov.data.prewarm || []).some((p) => p.business === "Terrapin Restaurant" && p.toName === "Rodney Einhorn" && /Jeff Rimmer/.test(p.draft)), `got ${(ov.data.prewarm || []).length}`);
  const repSurfaces = JSON.stringify([await TONY.client("GET", "/api/bdev/kit"), terrapinDetail]);
  check("pre-warm drafts never leak into any rep payload", !/Jeff Rimmer here, founder/.test(repSurfaces), "");
  const flag = await store.get("config:bdevEnrich157");
  check("the loader's flag is set (one-time, claimed)", !!(flag && flag.done), "");
}

// --- C: official status ------------------------------------------
console.log("== C: status control ==");
{
  const leads = await TONY.client("GET", "/api/bdev/leads");
  const terra = leads.data.leads.find((l) => l.id === terrapinId);
  check("an untouched lead reads Not contacted (derived from its stage)", terra.status === "Not contacted", terra.status);
  const set = await TONY.client("POST", `/api/bdev/leads/${terrapinId}/status`, { status: "Follow up" });
  check("the rep sets the official status", set.status === 200 && set.data.lead.status === "Follow up", `got ${set.status}`);
  check("the change is written into the lead's history", (set.data.lead.statusHistory || []).length === 1 && set.data.lead.statusHistory[0].status === "Follow up", "");
  const bad = await TONY.client("POST", `/api/bdev/leads/${terrapinId}/status`, { status: "Kinda interested" });
  check("a status off the list is refused", bad.status === 400, `got ${bad.status}`);
  const hqSet = await admin("POST", `/api/admin/bdev/leads/${terrapinId}/status`, { status: "Meeting set" });
  check("HQ can set it too", hqSet.status === 200, `got ${hqSet.status}`);
  const detail = await TONY.client("GET", `/api/bdev/leads/${terrapinId}`);
  check("...and the rep sees HQ's word on his lead", detail.data.lead.status === "Meeting set" && detail.data.lead.statusHistory.length === 2, detail.data.lead.status);
  // Derivation: a worked lead with no explicit status reads Contacted.
  await TONY.client("POST", `/api/bdev/leads/${castrosId}/log`, { clientUid: "uid-157-castros", outcome: "Talked — needs to think", spokeWith: "Owner", spokeName: "Alisa Castro" });
  const cDetail = await TONY.client("GET", `/api/bdev/leads/${castrosId}`);
  check("a talked-to lead derives Contacted until someone sets it", cDetail.data.lead.status === "Contacted", cDetail.data.lead.status);
  const ov = await admin("GET", "/api/admin/bdev/overview");
  const rollSrc = ov.data.statusRollup || {};
  const rollArr = Array.isArray(rollSrc) ? rollSrc : Object.values(rollSrc);
  const roll = rollArr.find((r) => r && r.marketId === "hampton-roads") || rollArr[0] || null;
  const byStatus = roll && roll.byStatus;
  check("admin roll-up counts every lead exactly once", !!byStatus && Object.values(byStatus).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0) === 32, JSON.stringify(ov.data.statusRollup).slice(0, 200));
  check("roll-up breaks out by city and neighborhood", !!roll && Array.isArray(roll.byCity) && roll.byCity.length >= 4 && Array.isArray(roll.byNeighborhood) && roll.byNeighborhood.length >= 10, "");
}

// --- D: queue, trips, alarms --------------------------------------
console.log("== D: next best doors ==");
{
  // An overdue follow-up on Codex (due yesterday).
  await TONY.client("POST", `/api/bdev/leads/${codexId}/log`, { clientUid: "uid-157-codex", outcome: "Talked to staff — need the owner", spokeWith: "Manager", followUpDate: daysFromNow(-1), visitType: "In person" });
  const q = await TONY.client("GET", "/api/bdev/queue");
  check("the queue answers", q.status === 200 && Array.isArray(q.data.queue) && q.data.queue.length >= 10, `got ${q.status}/${(q.data.queue || []).length}`);
  check("labels run Start here (max 3) → Next up → Later", q.data.queue.slice(0, 3).every((i) => i.label === "Start here") && q.data.queue.some((i) => i.label === "Later") && q.data.queue.every((i) => typeof i.why === "string" && i.why.length > 3), "");
  const codexItem = q.data.queue.find((i) => i.lead.id === codexId);
  check("an overdue follow-up climbs the queue with its reason in plain words", !!codexItem && q.data.queue.indexOf(codexItem) < 10 && /follow-up is late/i.test(codexItem.why), codexItem && codexItem.why);
  // A locked lead never appears as a door.
  await admin("POST", `/api/admin/bdev/leads/${dupreId}/flags`, { doNotContact: true });
  const q2 = await TONY.client("GET", "/api/bdev/queue");
  check("a do-not-contact lead is never a suggested door", !q2.data.queue.some((i) => i.lead.id === dupreId), "");
  const trips = await TONY.client("GET", "/api/bdev/trips");
  check("trip clusters group the book by neighborhood", trips.status === 200 && trips.data.trips.length >= 4 && trips.data.trips.every((t) => t.zone && t.count >= 1 && t.first), `got ${(trips.data.trips || []).length}`);
  const home = await TONY.client("GET", "/api/bdev/home");
  check("home carries the queue (top doors) and the alarms", Array.isArray(home.data.queue) && home.data.queue.length >= 1 && Array.isArray(home.data.alarms), "");
  const alarm = (home.data.alarms || []).find((a) => a.leadId === codexId);
  check("the overdue follow-up pings gently, in words", !!alarm && /still waiting/.test(alarm.line) && /1 day late/.test(alarm.line), alarm && alarm.line);
  check("home scoreboard field exists (null or a record)", home.data.scoreboard === null || typeof home.data.scoreboard === "object", "");
}

// --- E: practice with Maggie ---------------------------------------
console.log("== E: practice ==");
{
  const kit = await TONY.client("GET", "/api/bdev/kit");
  check("the kit now carries 8 practice scenarios", Array.isArray(kit.data.practice) && kit.data.practice.length === 8, `got ${(kit.data.practice || []).length}`);
  const p1 = kit.data.practice.find((p) => p.n === 1);
  check("scenario 1's approved answer IS the kit's price answer, verbatim", !!p1 && p1.answer === kit.data.kit.priceAnswers[0].text, "");
  const p2 = kit.data.practice.find((p) => p.n === 2);
  const launchObj = kit.data.kit.objections.find((o) => o.key === "Asked when it launches");
  check("scenario 2's approved answer IS the kit's launch answer, verbatim", !!p2 && !!launchObj && p2.answer === launchObj.a, "");
  check("every scenario carries its trap, its weak line and its why", kit.data.practice.every((p) => p.trap && p.weak && p.why && p.answer), "");
  check("no practice answer invents a date, a discount or a spot number", kit.data.practice.every((p) => !/next month|free month|You're #/i.test(p.answer)), "");
}

// --- F: See Tony's view (preview) -----------------------------------
console.log("== F: preview ==");
{
  const countLogs = async () => (await store.list("bdevlog:")).length;
  const countClaims = async () => (await store.list("bdevclaim:")).length;
  const terraBefore = await store.get(`bdevlead:${terrapinId}`);
  const logsBefore = await countLogs(), claimsBefore = await countClaims();
  const pv = await admin("GET", `/api/admin/bdev/preview?repId=${TONY.id}`);
  check("Jeff can open Tony's view", pv.status === 200 && pv.data.preview === true && pv.data.seat.repCode === "HR-TONY", `got ${pv.status}`);
  check("preview home is shaped like the real home (brief, doors, progress)", !!(pv.data.home && Array.isArray(pv.data.home.brief) && Array.isArray(pv.data.home.queue) && pv.data.home.progress), "");
  check("preview carries his whole book, kit and money", (pv.data.leads || []).length === 32 && !!pv.data.kit && !!(pv.data.money && pv.data.money.money), "");
  const pvl = await admin("GET", `/api/admin/bdev/preview/lead?repId=${TONY.id}&lead=${terrapinId}`);
  check("preview lead detail carries the playbook, read-only shape", pvl.status === 200 && !!(pvl.data.lead && pvl.data.lead.playbook), `got ${pvl.status}`);
  check("preview show bench never seats Tony the tester", !!(pvl.data.show && Array.isArray(pvl.data.show.bench)) && !pvl.data.show.bench.some((c) => c.handle === "tonyjohnson374"), "");
  check("SUPPRESSION: preview wrote no logs and no claims", (await countLogs()) === logsBefore && (await countClaims()) === claimsBefore, "");
  const terraAfter = await store.get(`bdevlead:${terrapinId}`);
  check("SUPPRESSION: the lead record is byte-identical after preview", terraAfter.updatedAt === terraBefore.updatedAt && terraAfter.stage === terraBefore.stage, "");
  const repTry = await TONY.client("GET", `/api/admin/bdev/preview?repId=${TONY.id}`);
  check("a rep cannot open the preview of anyone", repTry.status === 403, `got ${repTry.status}`);
  const bogus = await admin("GET", "/api/admin/bdev/preview?repId=00000000-0000-0000-0000-000000000000");
  check("a seat that doesn't exist 404s", bogus.status === 404, `got ${bogus.status}`);
}

// --- G: sweep — alarms + the Monday scoreboard ----------------------
console.log("== G: sweep ==");
{
  const noAuth = await anon("POST", "/api/admin/bdev/sweep", {});
  check("the sweep refuses anonymous callers", noAuth.status === 403, `got ${noAuth.status}`);
  const sw = await admin("POST", "/api/admin/bdev/sweep", {});
  check("an admin (or the token) can run the sweep", sw.status === 200 && !!sw.data.sweep, `got ${sw.status}`);
  const ov = await admin("GET", "/api/admin/bdev/overview");
  check("the alarm record reached Jeff's view (Codex is waiting)", (ov.data.alarmSummary || []).some((a) => a.repId === TONY.id && a.count >= 1), JSON.stringify(ov.data.alarmSummary || {}));
  // Time-travel to the NEXT Monday (TEST_MODE honors `now`): a
  // fresh week, so generation must write. (Today may itself be a
  // Monday — the plain sweep above already owns this week's.)
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  do { monday.setUTCDate(monday.getUTCDate() + 1); } while (monday.getUTCDay() !== 1);
  const sw2 = await admin("POST", "/api/admin/bdev/sweep", { now: monday.toISOString() });
  check("the Monday run writes scoreboards", sw2.status === 200 && (sw2.data.sweep.scoreboardsWritten || 0) >= 1, JSON.stringify(sw2.data.sweep || {}));
  const ov2 = await admin("GET", "/api/admin/bdev/overview");
  const board = (ov2.data.scoreboards || []).find((s) => s.repId === TONY.id);
  check("Jeff sees Tony's scoreboard in the overview", !!board && Array.isArray(board.lines) && board.lines.length >= 1, "");
  check("the scoreboard speaks in plain sentences (no insider terms)", !!board && board.lines.every((l) => !/pipeline|CRM|conversion/i.test(l)), board && board.lines.join(" "));
  const sw3 = await admin("POST", "/api/admin/bdev/sweep", { now: monday.toISOString() });
  check("a Monday re-run never doubles a scoreboard", (sw3.data.sweep.scoreboardsWritten || 0) === 0, JSON.stringify(sw3.data.sweep || {}));
}

// --- I: the Business Explainer Kit lives in the Seller Kit ---------
console.log("== I: explainer kit ==");
{
  const kitRes = await TONY.client("GET", "/api/bdev/kit");
  const k = kitRes.data.kit || {};
  check("print kit carries both PDFs with Tony's plain labels", Array.isArray(k.printKit) && k.printKit.length === 2
    && k.printKit[0].label === "Your leave-behind cards — print these"
    && k.printKit[1].label === "The business one-pager — leave this behind"
    && k.printKit[0].url.endsWith("magpie-leavebehind-tony-v6-2026-11-09-print.pdf")
    && k.printKit[1].url.endsWith("magpie-business-onepager-tony-v2-2026-11-09-print.pdf"), JSON.stringify(k.printKit).slice(0, 200));
  check("the 30-second opener now leads with the anchor phrase", (k.openers[0].text || "").includes("Magpie is local influencer marketing: real creators right here in Hampton Roads")
    && !(k.openers[0].text || "").includes("founding list of Hampton Roads creators"), (k.openers[0].text || "").slice(0, 120));
  check("the 2-minute version is in the kit, anchor up front", !!k.twoMinute && (k.twoMinute.paras || []).length === 4
    && (k.twoMinute.paras[1] || "").startsWith("Magpie is local influencer marketing."), "");
  const faq = k.faq || [];
  const norm = (s) => String(s || "").toLowerCase().replace(/[“”".,?—-]/g, "").replace(/\s+/g, " ").trim();
  const objQs = new Set((k.objections || []).map((o) => norm(o.q)));
  check("the business FAQ joined the kit (10 questions)", faq.length === 10, `faq=${faq.length}`);
  check("no FAQ question duplicates an objection question", faq.every((f) => !objQs.has(norm(f.q))), faq.map((f) => f.q).join(" | "));
  const cost = faq.find((f) => f.q === "What does it cost?");
  check("the FAQ cost answer prints no prices (canon: numbers are spoken, never printed)", !!cost && !/[$\d]/.test(cost.a), cost ? cost.a.slice(0, 80) : "missing");
  const behind = faq.find((f) => /behind Magpie/.test(f.q));
  check("the who's-behind answer carries Jeff's locked bio line", !!behind && behind.a.includes("two decades in local media and startups"), "");
  const fsx = await import("node:fs");
  const pathx = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const rootx = pathx.dirname(pathx.dirname(fileURLToPath(import.meta.url)));
  for (const [file, min] of [["magpie-leavebehind-tony-v6-2026-11-09-print.pdf", 100000], ["magpie-business-onepager-tony-v2-2026-11-09-print.pdf", 500000]]) {
    const p = pathx.join(rootx, "public", "assets", file);
    const okFile = fsx.existsSync(p) && fsx.statSync(p).size > min && fsx.readFileSync(p).subarray(0, 4).toString() === "%PDF";
    check(`print asset ships as a real PDF: ${file}`, okFile, "");
  }
  const pv = await admin("GET", `/api/admin/bdev/preview?repId=${TONY.id}`);
  const pk = (pv.data.kit && pv.data.kit.kit) || {};
  check("Jeff's preview of the kit shows the print kit + FAQ too", Array.isArray(pk.printKit) && pk.printKit.length === 2 && Array.isArray(pk.faq) && pk.faq.length === 10, "");
}

// --- H: filters + payments off ---------------------------------------
console.log("== H: filters + payments ==");
{
  const cities = await TONY.client("GET", "/api/bdev/leads?city=Norfolk");
  check("the rep book filters by city", cities.status === 200 && cities.data.leads.length >= 3 && cities.data.leads.every((l) => l.city === "Norfolk"), `got ${cities.data.leads.length}`);
  check("the leads response carries filter facets", !!(cities.data.facets && cities.data.facets.cities.length >= 4 && cities.data.facets.neighborhoods.length >= 10), "");
  const nbs = await TONY.client("GET", `/api/bdev/leads?neighborhood=${encodeURIComponent("Ghent Norfolk")}`);
  check("...and by neighborhood", nbs.status === 200 && nbs.data.leads.length >= 1 && nbs.data.leads.every((l) => l.neighborhood === "Ghent Norfolk"), `got ${nbs.data.leads.length}`);
  const BIZC = makeClient();
  const br = await BIZC("POST", "/api/auth/register", { role: "business", name: "Fixture Owner", email: `fixture-biz-${uniq()}@fixtures.dev`, password: PW, market: "Virginia Beach", city: "Virginia Beach", businessName: "Fixture Eats", category: "Restaurant", planId: "growth", agreedTerms: true });
  check("fixture business registers", br.status === 201, `got ${br.status}`);
  const checkout = await BIZC("POST", "/api/billing/checkout", { planId: "growth" });
  check("payments stay OFF: checkout refuses (503)", checkout.status === 503, `got ${checkout.status}`);
}

console.log(`\nverify-build157: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
