#!/usr/bin/env node
// Build -107 verification (Tier 3 item 17: partner self-serve
// team seats). Proves, against the real dev server on 9025:
//   - the teamAdmin flag is Admin-set only (PATCH on the org
//     lead works; on a team member it is refused), and only a
//     teamAdmin session can read or use the team routes;
//   - all three seat kinds mint through the existing invite
//     plumbing: partner team member (teamOf), pilot seat
//     (invitedByPartner on the org's own pilot scope),
//     recruiter (sponsorPartnerId entity in the org's own
//     market) — invite -> password set (the TEST_MODE token
//     hook, same trust boundary as the pilots/forgot flows)
//     -> login round trips;
//   - fences: inviting into another partner's pilot or market
//     is refused; a team member's summary equals the org's on
//     totals but carries NO deal terms (share %, deal label,
//     guarantee, territory, at-fill all stripped); the member
//     is refused the month pack and the team routes; the
//     member resolves the ORG's pilot scopes;
//   - revoke: the seat's live session dies on its next
//     request, the record reads revoked, the entity disables,
//     and the org's attributed numbers do not move (the work
//     stays credited);
//   - Admin: seat counts on the partner list, the detail
//     rollup including the Admin-minted pilot lead (labeled),
//     and the revoke-anything override;
//   - funders: the pilot lead becomes team admin via the
//     pilot PATCH and seats people onto their own pilot only;
//   - Sig: the partner Sig lists seats, proposes an invite
//     and a revoke as confirm-first actions whose payloads
//     execute against the real endpoints; Admin Sig reports
//     the org's seats and minters; the 7-day unaccepted chip
//     fires on /sig/home;
//   - canon locks: stamp -107, founding prices unarmed.
//
// Run: node scripts/verify-build107.mjs

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 9025;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@b107.dev";
const ADMIN_PASSWORD = ["fixture", "admin", "107"].join("-");

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

class Client {
  constructor() { this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, p, body) {
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) { const [pair] = sc.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
    let data = null; try { data = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, data };
  }
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("fixture-pass-107", salt, 64).toString("hex");
const SEP = "2026-09-01T00:00:00.000Z";
const OLD = "2026-10-24T00:00:00.000Z"; // 10 days before the suite's "now" (Nov 3)
const data = {};
function partner(id, name, code, markets, extra = {}) {
  data[`user:${id}`] = { id, role: "partner", email: `${id}@b107.dev`, name, passwordSalt: salt, passwordHash: hash, status: "approved", market: markets[0], createdAt: SEP, updatedAt: SEP, partner: { name, code, type: "media", contactName: "Pat Fixture", markets, sharePct: 60, status: "active", agreementStatus: "signed", agreementSignedAt: SEP, demo: false, ...extra } };
  data[`email:${id}@b107.dev`] = { userId: id };
}
partner("partner-a", "Fixture Media A", "fma", ["Nashville", "Austin"]);
partner("partner-b", "Fixture Media B", "fmb", ["Denver"]);
// A business partner A's link brought in: the attributed work
// that must survive every revoke untouched.
data["user:biz-attr"] = { id: "biz-attr", role: "business", email: "biz-attr@b107.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", signupSource: "partner-fma", createdAt: SEP, updatedAt: SEP, business: { businessName: "Attributed Eats", category: "Restaurant", accessState: "active" } };
data["email:biz-attr@b107.dev"] = { userId: "biz-attr" };
// Pilots: Denver has a legacy funder lead; Austin is nobody's
// scope (the escape target).
data["pilot:pilot-denver"] = { id: "pilot-denver", name: "Denver Launch Pilot", partnerName: "Fixture Fund", marketId: "denver", marketName: "Denver", fundCents: 500000, status: "active", partnerUserId: "pp-fran", createdBy: "fixture", createdAt: SEP, updatedAt: SEP };
data["pilot:pilot-austin"] = { id: "pilot-austin", name: "Austin Launch Pilot", partnerName: "Other Fund", marketId: "austin", marketName: "Austin", fundCents: 250000, status: "active", partnerUserId: null, createdBy: "fixture", createdAt: SEP, updatedAt: SEP };
data["user:pp-fran"] = { id: "pp-fran", role: "pilot_partner", email: "fran@b107.dev", name: "Fran Fund", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Denver", createdAt: SEP, updatedAt: SEP, pilotId: "pilot-denver", pilotPartner: { partnerName: "Fixture Fund", pilotName: "Denver Launch Pilot" } };
data["email:fran@b107.dev"] = { userId: "pp-fran" };
// Ollie: a pilot seat partner A minted 10 days ago that never
// accepted — the stale-invite chip's fixture.
data["user:pp-ollie"] = { id: "pp-ollie", role: "pilot_partner", email: "ollie@b107.dev", name: "Ollie Old", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Denver", createdAt: OLD, updatedAt: OLD, pilotId: "pilot-denver", invitedByPartner: "partner-a", invitePending: true, pilotPartner: { partnerName: "Fixture Fund", pilotName: "Denver Launch Pilot" } };
data["email:ollie@b107.dev"] = { userId: "pp-ollie" };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build107-"));
const DB = path.join(tmp, "db.json");
fs.writeFileSync(DB, JSON.stringify(data));
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_TEST_ALLOW_BUSINESS: "1", SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "NOTIFY_EMAIL_FROM", "SQUARE_APP_ID", "SQUARE_APP_SECRET"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
process.on("exit", () => { try { server.kill("SIGKILL"); } catch (e) { /* already gone */ } });
for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) break; } catch (e) { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)); }

const admin = new Client();
{ const r = await admin.req("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }); if (r.status !== 200) throw new Error(`admin login: ${r.status}`); }
async function loginAs(email, password = "fixture-pass-107") {
  const c = new Client();
  const r = await c.req("POST", "/api/auth/login", { email, password });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  return c;
}
const dbNow = () => JSON.parse(fs.readFileSync(DB, "utf8"));
const ask = async (client, q) => { const r = await client.req("POST", "/api/sig/ask", { q }); return r.data || {}; };
async function acceptInvite(token, email, password) {
  const c = new Client();
  const r = await c.req("POST", "/api/auth/reset", { token, password });
  if (r.status !== 200) throw new Error(`reset for ${email}: ${r.status} ${JSON.stringify(r.data || {})}`);
  return loginAs(email, password);
}

// ---------- the flag is Admin-set; the routes are fenced ----------
console.log("Team seats — flag and fences");
const pA = await loginAs("partner-a@b107.dev");
const pB = await loginAs("partner-b@b107.dev");
const fran = await loginAs("fran@b107.dev");
const teamBefore = await pA.req("GET", "/api/partner/team");
check("a partner without the teamAdmin flag is refused the team routes", teamBefore.status === 403, `status ${teamBefore.status}`);
const flagOn = await admin.req("PATCH", "/api/admin/partners/partner-a", { teamAdmin: true });
check("Admin sets teamAdmin on the org lead", flagOn.status === 200 && flagOn.data.partner && flagOn.data.partner.teamAdmin === true, `status ${flagOn.status} ${JSON.stringify(flagOn.data || {}).slice(0, 140)}`);
const team0 = await pA.req("GET", "/api/partner/team");
check("the team view opens with the org's own scopes", team0.status === 200 && team0.data.markets.join(",") === "Nashville,Austin" && team0.data.seats.length === 1 && team0.data.seats[0].email === "ollie@b107.dev", JSON.stringify(team0.data || {}).slice(0, 200));
const bTeam = await pB.req("GET", "/api/partner/team");
check("the other partner is refused (no flag)", bTeam.status === 403, `status ${bTeam.status}`);
const summaryBefore = await pA.req("GET", "/api/partner/summary");
check("baseline: one business attributed to partner A", summaryBefore.status === 200 && summaryBefore.data.totals.businessesAttributed === 1 && summaryBefore.data.viewer.teamAdmin === true, JSON.stringify(summaryBefore.data && summaryBefore.data.totals));

// ---------- seat kind 1: partner team member ----------
console.log("Seat kind: team member");
const invTeam = await pA.req("POST", "/api/partner/team/invite", { kind: "team", name: "Alex Member", email: "alex@b107.dev" });
check("team invite is created", invTeam.status === 201 && !!invTeam.data.seatId && !!invTeam.data.devResetToken, `status ${invTeam.status} ${JSON.stringify(invTeam.data || {}).slice(0, 140)}`);
const alexId = invTeam.data.seatId;
const alexRec = dbNow()[`user:${alexId}`];
check("the member record points at the org (teamOf), invite pending", !!alexRec && alexRec.partner.teamOf === "partner-a" && alexRec.invitePending === true, JSON.stringify(alexRec && alexRec.partner));
// Build -139 (Jeff, 2026-11-06, Item 13): a seat's first email is the
// team WELCOME (kind team_welcome), never the bare password_reset mail.
const mailEvents = Object.values(dbNow()).filter((v) => v && v.type === "team_welcome_email_sent" && v.subjectId === alexId);
check("the invite email went out through the mail seam (as the team welcome since -139)", mailEvents.length >= 1, `${mailEvents.length} events`);
const alex = await acceptInvite(invTeam.data.devResetToken, "alex@b107.dev", "alex-new-pass-107");
const alexRec2 = dbNow()[`user:${alexId}`];
check("setting the first password stamps acceptance", !!alexRec2.inviteAcceptedAt && !alexRec2.invitePending, JSON.stringify({ a: alexRec2.inviteAcceptedAt, p: alexRec2.invitePending }));
const memberSummary = await alex.req("GET", "/api/partner/summary");
check("the member reads the ORG's summary (same attributed totals)", memberSummary.status === 200 && memberSummary.data.totals.businessesAttributed === 1 && memberSummary.data.viewer.isTeamMember === true, JSON.stringify(memberSummary.data && memberSummary.data.totals));
check("the member's copy carries NO deal terms", memberSummary.data.earnings.sharePct === null && memberSummary.data.earnings.dealLabel === null && memberSummary.data.earnings.guaranteeState === null && memberSummary.data.territory.length === 0 && memberSummary.data.atFill === null && memberSummary.data.partner.sharePct === null, JSON.stringify(memberSummary.data.earnings).slice(0, 160));
check("the member still sees accrued totals (org earnings, not terms)", typeof memberSummary.data.earnings.accruedTotal === "number", "");
const memberPack = await alex.req("GET", "/api/partner/pack?month=2026-09");
check("the member is refused the month pack (the deal math)", memberPack.status === 403, `status ${memberPack.status}`);
const memberTeam = await alex.req("GET", "/api/partner/team");
check("the member is refused the team routes", memberTeam.status === 403, `status ${memberTeam.status}`);
const flagMember = await admin.req("PATCH", "/api/admin/partners/" + alexId, { teamAdmin: true });
check("Admin cannot make a team MEMBER the team admin", flagMember.status === 400, `status ${flagMember.status}`);

// ---------- seat kind 2: pilot seat (scope fences) ----------
console.log("Seat kind: pilot seat");
const attach = await admin.req("PATCH", "/api/admin/partners/partner-a", { scopes: [{ kind: "pilot", pilotId: "pilot-denver" }] });
check("Admin attaches the Denver pilot scope to partner A", attach.status === 200, `status ${attach.status}`);
const memberPilot = await alex.req("GET", "/api/pilot/me");
check("the team member resolves the ORG's pilot scope", memberPilot.status === 200 && memberPilot.data.pilot && memberPilot.data.pilot.id === "pilot-denver", `status ${memberPilot.status}`);
const escapePilot = await pA.req("POST", "/api/partner/team/invite", { kind: "pilot", name: "Eve Escape", email: "eve@b107.dev", pilotId: "pilot-austin" });
check("inviting into a pilot that is not the org's scope is refused", escapePilot.status === 403, `status ${escapePilot.status}`);
const invPilot = await pA.req("POST", "/api/partner/team/invite", { kind: "pilot", name: "Pat Pilot", email: "pat@b107.dev", pilotId: "pilot-denver" });
check("pilot invite into the org's own scope is created", invPilot.status === 201 && !!invPilot.data.devResetToken, `status ${invPilot.status} ${JSON.stringify(invPilot.data || {}).slice(0, 130)}`);
const patId = invPilot.data.seatId;
const patRec = dbNow()[`user:${patId}`];
check("the pilot seat is stamped invitedByPartner", !!patRec && patRec.role === "pilot_partner" && patRec.pilotId === "pilot-denver" && patRec.invitedByPartner === "partner-a", JSON.stringify(patRec && { r: patRec.role, p: patRec.pilotId, i: patRec.invitedByPartner }));
const pat = await acceptInvite(invPilot.data.devResetToken, "pat@b107.dev", "pat-new-pass-107");
const patMe = await pat.req("GET", "/api/pilot/me");
check("the pilot seat logs into the Impact Portal", patMe.status === 200 && patMe.data.pilot.id === "pilot-denver", `status ${patMe.status}`);

// ---------- seat kind 3: recruiter (market fence) ----------
console.log("Seat kind: recruiter");
const escapeRec = await pA.req("POST", "/api/partner/team/invite", { kind: "recruiter", name: "Eve Escape", email: "eve2@b107.dev", market: "Denver" });
check("seating a recruiter in another partner's market is refused", escapeRec.status === 403, `status ${escapeRec.status}`);
const invRec = await pA.req("POST", "/api/partner/team/invite", { kind: "recruiter", name: "Rae Recruiter", email: "rae@b107.dev", market: "Austin" });
check("recruiter invite in the org's own market is created", invRec.status === 201 && !!invRec.data.devResetToken, `status ${invRec.status} ${JSON.stringify(invRec.data || {}).slice(0, 130)}`);
const recEntityId = invRec.data.seatId;
const recEntity = dbNow()[`recruiter:${recEntityId}`];
check("the recruiter entity names the sponsoring partner", !!recEntity && recEntity.sponsorPartnerId === "partner-a" && recEntity.marketName === "Austin" && recEntity.status === "active", JSON.stringify(recEntity && { s: recEntity.sponsorPartnerId, m: recEntity.marketName }));
const rae = await acceptInvite(invRec.data.devResetToken, "rae@b107.dev", "rae-new-pass-107");
const raeMe = await rae.req("GET", "/api/auth/me");
check("the recruiter seat logs in as a recruiter", raeMe.status === 200 && raeMe.data.user && raeMe.data.user.role === "recruiter", `status ${raeMe.status}`);
const dup = await pA.req("POST", "/api/partner/team/invite", { kind: "team", name: "Alex Again", email: "alex@b107.dev" });
check("a second seat for the same email is refused", dup.status === 400, `status ${dup.status}`);

// ---------- the list, resend, and Sig ----------
console.log("Team list + Sig");
const teamList = await pA.req("GET", "/api/partner/team");
const kinds = (teamList.data.seats || []).map((s) => s.kind).sort();
check("the team list carries all four seats (3 new + Ollie)", teamList.status === 200 && teamList.data.seats.length === 4 && kinds.join(",") === "pilot,pilot,recruiter,team", JSON.stringify(kinds) + " " + teamList.data.seats.length);
check("accepted seats read active, the stale one reads invited", teamList.data.seats.find((s) => s.email === "alex@b107.dev").status === "active" && teamList.data.seats.find((s) => s.email === "ollie@b107.dev").status === "invited", JSON.stringify(teamList.data.seats.map((s) => [s.email, s.status])));
const resend = await pA.req("POST", "/api/partner/team/resend", { seatId: "pp-ollie" });
check("resend re-issues the invite", resend.status === 200 && resend.data.ok === true, `status ${resend.status}`);
const home = await pA.req("GET", "/api/sig/home");
check("/sig/home carries the 7-day unaccepted chip", home.status === 200 && (home.data.chips || []).some((c) => /hasn't accepted their invite/.test(typeof c === "string" ? c : (c.text || ""))), JSON.stringify(home.data && home.data.chips));
const listAsk = await ask(pA, "Who is on my team?");
check("partner Sig lists the seats from the record", listAsk.source === "data" && /Alex Member/.test(listAsk.text || "") && /Rae Recruiter/.test(listAsk.text || ""), JSON.stringify(listAsk).slice(0, 220));
const invAsk = await ask(pA, "Invite Kim New (kim@b107.dev) to my team");
check("partner Sig proposes the invite as a confirm-first action", invAsk.source === "data" && invAsk.action && invAsk.action.type === "team_invite" && invAsk.action.payload.kind === "team" && invAsk.action.payload.email === "kim@b107.dev", JSON.stringify(invAsk).slice(0, 260));
const invExec = await pA.req("POST", "/api/partner/team/invite", invAsk.action.payload);
check("the Sig-proposed invite payload executes against the real endpoint", invExec.status === 201, `status ${invExec.status} ${JSON.stringify(invExec.data || {}).slice(0, 120)}`);
const kimId = invExec.data.seatId;
const revAsk = await ask(pA, "Revoke Pat Pilot");
check("partner Sig proposes the revoke as a confirm-first action", revAsk.source === "data" && revAsk.action && revAsk.action.type === "team_revoke" && revAsk.action.payload.seatId === patId, JSON.stringify(revAsk).slice(0, 240));

// ---------- revoke: access dies, the work stays ----------
console.log("Revoke");
const revExec = await pA.req("POST", "/api/partner/team/revoke", revAsk.action.payload);
check("the revoke executes", revExec.status === 200 && revExec.data.ok === true, `status ${revExec.status}`);
const patAfter = await pat.req("GET", "/api/pilot/me");
check("the revoked seat's live session dies on its next request", patAfter.status === 401 || patAfter.status === 403, `status ${patAfter.status}`);
const patRec2 = dbNow()[`user:${patId}`];
check("the revoked record reads revoked (and stays on file)", patRec2.status === "revoked", patRec2.status);
const revAlex = await pA.req("POST", "/api/partner/team/revoke", { seatId: alexId });
check("the team member's seat revokes too", revAlex.status === 200, `status ${revAlex.status}`);
const alexAfter = await alex.req("GET", "/api/partner/summary");
check("the revoked member's session is dead too", alexAfter.status === 401 || alexAfter.status === 403, `status ${alexAfter.status}`);
const summaryAfter = await pA.req("GET", "/api/partner/summary");
check("the org's attributed numbers did not move (the work stays credited)", summaryAfter.status === 200 && summaryAfter.data.totals.businessesAttributed === 1, JSON.stringify(summaryAfter.data && summaryAfter.data.totals));
const foreignRevoke = await pA.req("POST", "/api/partner/team/revoke", { seatId: "pp-fran" });
check("the partner cannot revoke an Admin-created seat (it is not in their list)", foreignRevoke.status === 404, `status ${foreignRevoke.status}`);

// ---------- Admin rollup + override ----------
console.log("Admin rollup");
const list = await admin.req("GET", "/api/admin/partners");
const rowA = (list.data.partners || []).find((p) => p.id === "partner-a");
check("the partner list counts live seats (Kim + Rae + Ollie = 3)", rowA && rowA.teamSeatCount === 3, JSON.stringify(rowA && rowA.teamSeatCount));
const detail = await admin.req("GET", "/api/admin/command/partners/partner-a?period=2026-11");
const dSeats = (detail.data.team && detail.data.team.seats) || [];
const franSeat = dSeats.find((s) => s.userId === "pp-fran");
check("the Admin rollup includes the Admin-minted pilot lead, labeled", !!franSeat && franSeat.mintedBy === "admin", JSON.stringify(dSeats.map((s) => [s.name, s.mintedBy])));
check("the rollup shows partner-minted seats as partner-minted", dSeats.filter((s) => s.mintedBy === "partner").length >= 4, `${dSeats.filter((s) => s.mintedBy === "partner").length}`);
const adminAsk = await ask(admin, "How many team seats does Fixture Media A have?");
check("Admin Sig reports the org's seats and who minted them", adminAsk.source === "data" && /Fixture Media A/.test(adminAsk.text || "") && /invited by the partner/.test(adminAsk.text || ""), JSON.stringify(adminAsk).slice(0, 260));
const adminRevoke = await admin.req("POST", "/api/admin/partners/team-revoke", { seatId: recEntityId });
check("Admin's override revokes the recruiter seat", adminRevoke.status === 200 && adminRevoke.data.ok === true, `status ${adminRevoke.status}`);
const recEntity2 = dbNow()[`recruiter:${recEntityId}`];
const raeRec = Object.values(dbNow()).find((v) => v && v.email === "rae@b107.dev");
check("the recruiter entity disables and its login revokes", recEntity2.status === "disabled" && raeRec.status === "revoked", `${recEntity2.status}/${raeRec.status}`);
const raeAfter = await rae.req("GET", "/api/auth/me");
check("the revoked recruiter's session is dead", !(raeAfter.data && raeAfter.data.user), JSON.stringify(raeAfter.data || {}).slice(0, 100));

// ---------- funders seat their own pilot team ----------
console.log("Funder team");
const franTeam0 = await fran.req("GET", "/api/partner/team");
check("the funder is refused before Admin names them team admin", franTeam0.status === 403, `status ${franTeam0.status}`);
const pilotPatch = await admin.req("PATCH", "/api/admin/pilots/pilot-denver", { teamAdminPartner: true });
check("Admin names the funder lead team admin via the pilot PATCH", pilotPatch.status === 200, `status ${pilotPatch.status}`);
const franTeam = await fran.req("GET", "/api/partner/team");
check("the funder's team view is scoped to their pilot", franTeam.status === 200 && franTeam.data.isFunder === true && franTeam.data.pilots.length === 1 && franTeam.data.pilots[0].id === "pilot-denver", JSON.stringify(franTeam.data || {}).slice(0, 160));
const franTeamKind = await fran.req("POST", "/api/partner/team/invite", { kind: "team", name: "Nope", email: "nope@b107.dev" });
check("a funder cannot mint partner logins", franTeamKind.status === 400, `status ${franTeamKind.status}`);
const franInv = await fran.req("POST", "/api/partner/team/invite", { kind: "pilot", name: "Sam Second", email: "sam@b107.dev", pilotId: "pilot-denver" });
check("the funder seats a pilot team member", franInv.status === 201 && !!franInv.data.devResetToken, `status ${franInv.status}`);
const sam = await acceptInvite(franInv.data.devResetToken, "sam@b107.dev", "sam-new-pass-107");
const samMe = await sam.req("GET", "/api/pilot/me");
check("the funder's seat logs into the same pilot", samMe.status === 200 && samMe.data.pilot.id === "pilot-denver", `status ${samMe.status}`);
const franAsk = await ask(fran, "Who is on my team?");
check("funder Sig lists their pilot seats", franAsk.source === "data" && /Sam Second/.test(franAsk.text || ""), JSON.stringify(franAsk).slice(0, 200));

// ---------- canon locks ----------
console.log("Canon locks");
check("build stamp is -107 on both sides", fs.readFileSync(path.join(root, "public/index.html"), "utf8").includes("2026.11.06-140") && fs.readFileSync(path.join(root, "netlify/functions/lib/build.js"), "utf8").includes("2026.11.06-140"));
const routerSrc = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
check("founding Stripe prices stay unarmed (no market live for money)", /STRIPE_PRICE_FOUNDING_SELF_SERVICE \|\| ""/.test(routerSrc) && /STRIPE_PRICE_FOUNDING_GROWTH \|\| ""/.test(routerSrc) && /STRIPE_PRICE_FOUNDING_MANAGED \|\| ""/.test(routerSrc));
const appSrc = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
check("client wires the Team tab, the Admin team editor and the Sig action", appSrc.includes("teamTabHtml") && appSrc.includes("loadTeamTab") && appSrc.includes("pt-teamadmin-") && appSrc.includes("adminTeamRevoke") && appSrc.includes('"/partner/team/invite"') && appSrc.includes("apToggleTeamAdmin"));
check("the partner tab whitelist admits Team (rendered-QA catch: without it the rail showed Team but the body stayed on Home)", /const PARTNER_TABS = \[[^\]]*"Team"\]/.test(appSrc));

console.log(`\nbuild107: ${passed} passed, ${failed} failed`);
if (fails.length) { console.log("FAILING: " + fails.join("; ")); process.exit(1); }
