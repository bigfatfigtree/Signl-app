// Outside-joins importer (Build -147; decision-layer spec
// 2026-11-08 §2 + §4). Reads the outside streams where they
// live — the campaign-run folder's sent map + roster files +
// bounce manifest, and the hello@ Gmail form notifications —
// normalizes them into import items, and POSTs them in ordered
// batches to POST /api/admin/imports/outside, which writes
// them into the app store idempotently (impkey per item).
//
// Order matters for identity resolution: sends first, roster
// prospects second (both create the prospect mirror), then
// bounces and replies (which resolve people by email against
// it), then forms, then the conversion join.
//
// Usage:
//   node scripts/import-outside.mjs --base https://app.magpielocal.com \
//     --token "$SIGNL_SWEEP_TOKEN" [--only sends,rosters,bounces,replies,forms] \
//     [--dry-run] [--skip-gmail] [--campaign-dir ~/workspace/signl-campaign-run]
//
// Gmail access is READ-only (+triage / +read). Nothing here
// sends, labels, or modifies mail. Erasure requests recorded in
// the campaign state (a person asked for their data to be
// deleted) are honored absolutely: those records are excluded
// from every stream before anything is POSTed, and only the
// COUNT of exclusions is ever printed.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const argOf = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const BASE = argOf("--base", "https://app.magpielocal.com").replace(/\/$/, "");
const TOKEN = argOf("--token", process.env.SIGNL_SWEEP_TOKEN || "");
const DRY = args.includes("--dry-run");
const SKIP_GMAIL = args.includes("--skip-gmail");
const ONLY = (argOf("--only", "sends,rosters,bounces,replies,forms") || "").split(",").map((s) => s.trim()).filter(Boolean);
const CDIR = argOf("--campaign-dir", path.join(os.homedir(), "workspace/signl-campaign-run"));
const GMAIL_CLI = "/opt/hatch/bin/hatch_gws_cli";
const GMAIL_ACCT = "c328958914894a14bcb4b94be4f6e903";
const want = (s) => ONLY.includes(s);

// ---------- time helpers ----------
// Campaign records stamp ET wall times ("2026-11-06 14:55 ET").
// 2026 US DST: EDT (UTC-4) Mar 8 -> Nov 1, EST (UTC-5) after.
function etToIso(at) {
  const m = String(at || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const offset = (mo === "11" && Number(d) >= 1) || Number(mo) >= 12 || Number(mo) < 3 || (Number(mo) === 3 && Number(d) < 8) ? 5 : 4;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) + offset, Number(mi))).toISOString();
}
function dateOnlyToIso(ds) {
  const m = String(ds || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z` : null;
}

// ---------- erasure exclusions ----------
const state = JSON.parse(fs.readFileSync(path.join(CDIR, "state.json"), "utf8"));
const ERASURE_RE = /erasure|delete.{0,40}data|delete.{0,25}account/i;
const excludedHandles = new Set();
const excludedEmails = new Set();
let exclusionRecords = 0;
for (const listName of ["suppressed", "do_not_contact"]) {
  for (const e of state[listName] || []) {
    if (!e || typeof e !== "object") continue;
    if (ERASURE_RE.test(String(e.reason || ""))) {
      exclusionRecords += 1;
      if (e.handle) excludedHandles.add(String(e.handle).toLowerCase());
      if (e.email) excludedEmails.add(String(e.email).toLowerCase());
    }
  }
}
const isExcluded = (handle, email) =>
  (handle && excludedHandles.has(String(handle).toLowerCase())) ||
  (email && excludedEmails.has(String(email).toLowerCase()));

const items = [];
const stats = { excluded: 0 };

// ---------- 1. sends (state.json sent map) ----------
if (want("sends")) {
  const sent = state.sent || {};
  for (const [handle, v] of Object.entries(sent)) {
    if (!v || typeof v !== "object") continue;
    if (isExcluded(handle, v.email)) { stats.excluded += 1; continue; }
    const sentAt = v.sent_at ? new Date(v.sent_at).toISOString() : etToIso(v.at);
    const lane = v.channel === "tiktok_dm" || String(v.message_id || "").startsWith("mid.$") ? "dm" : "gmail";
    items.push({
      // Import key = the manifest row's own identity (handle +
      // message): the sent map carries three duplicated
      // message_ids — two TikTok DMs sharing a prose placeholder
      // ("no message id surfaced") and two sends each recorded
      // under alias handles (rudiberry/therudiberry,
      // taylorlegit/taylorlegit_). Keying on message_id alone
      // would silently drop real sends on the second occurrence.
      kind: "send", importKey: `send:${handle}:${v.message_id || sentAt || ""}`,
      handle, email: v.email || null, market: v.city || v.market || null, cityRaw: v.city || null,
      lane, messageId: v.message_id || null, template: v.template || null,
      sentAt, note: v.note || v.campaign_note || null,
    });
  }
}

// ---------- 2. roster prospects ----------
const MARKET_ALIAS = { "Dallas-Fort Worth": "Dallas" };
const ROSTER_FILES = [
  "atlanta-roster-2026-11-07.json", "charlotte-roster-2026-11-07.json", "copenhagen-roster-2026-11-07.json",
  "dallas-fort-worth-roster-2026-11-07.json", "los-angeles-roster-2026-11-07.json", "orlando-roster-2026-11-07.json",
  "raleigh-roster-2026-11-07.json", "tampa-roster-2026-11-07.json",
  "seattle-roster-2026-11-07.json", "paris-roster-2026-11-07.json",
  // NOT the combined charlotte-raleigh-roster-2026-11-07.json: it is the
  // pre-split source of the charlotte + raleigh files above (30 + 74 =
  // its 104), and Raleigh / Charlotte are separate markets, always.
];
if (want("rosters")) {
  for (const file of ROSTER_FILES) {
    const p = path.join(CDIR, file);
    if (!fs.existsSync(p)) { console.log(`roster file missing, skipped: ${file}`); continue; }
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    const verifiedAt = dateOnlyToIso(d.built || d.generated_at || d.generated || "2026-11-07");
    let entries = [];
    if (Array.isArray(d.roster)) entries = d.roster.map((e) => ({ e, lane: e.lane || null }));
    else if (Array.isArray(d.records)) entries = d.records.map((e) => ({ e, lane: e.lane || null }));
    else {
      if (Array.isArray(d.roster_email_ready)) entries = entries.concat(d.roster_email_ready.map((e) => ({ e, lane: "email" })));
      if (Array.isArray(d.roster_dm_lane)) entries = entries.concat(d.roster_dm_lane.map((e) => ({ e, lane: "dm" })));
    }
    for (const { e, lane } of entries) {
      if (!e || !e.handle) continue;
      if (isExcluded(e.handle, e.email)) { stats.excluded += 1; continue; }
      const rawMarket = e.city || d.market || d.city || null;
      items.push({
        kind: "prospect", importKey: `roster:${file}:${String(e.handle).toLowerCase()}`,
        handle: e.handle, name: e.name || null, email: e.email || null,
        market: MARKET_ALIAS[rawMarket] || rawMarket,
        category: e.category || null,
        followers: e.followers != null ? e.followers : (e.followers_total != null ? e.followers_total : null),
        followersDetail: e.followers_detail || null,
        localEvidence: e.local_evidence ? String(e.local_evidence).slice(0, 500) : null,
        lane: lane || null, emailSource: e.email_source || null,
        mxVerified: e.mx_verified != null ? !!e.mx_verified : null,
        verifiedAt, rosterFile: file,
      });
    }
  }
}

// ---------- 3+4. bounces & replies from structured state records ----------
const BOUNCE_RANK = { soft: 1, blocked: 2, hard: 3 };
if (want("bounces") || want("replies")) {
  for (const listName of ["suppressed", "do_not_contact"]) {
    for (const e of state[listName] || []) {
      if (!e || typeof e !== "object" || !e.handle) continue;
      if (ERASURE_RE.test(String(e.reason || ""))) continue; // excluded above, silently
      const reason = String(e.reason || "");
      const dateM = reason.match(/(2026-\d{2}-\d{2})/) || (e.date ? [null, e.date] : null);
      const at = dateM ? dateOnlyToIso(dateM[1]) : null;
      if (want("bounces") && /bounc|550|552|delivery status/i.test(reason)) {
        const cls = /5\.2\.2|552|inbox full/i.test(reason) ? "soft" : "hard";
        const codeM = reason.match(/\b([245]\.\d\.\d)\b/) || reason.match(/\b(550|552)\b/);
        items.push({ kind: "bounce", importKey: `state:${String(e.handle).toLowerCase()}`, handle: e.handle, email: e.email || null, market: e.market || null, at, bounceClass: cls, enhancedCode: codeM ? codeM[1] : null, smtpCode: null, noticeId: (reason.match(/\b(1a1[0-9a-f]{10,})\b/) || [])[1] || null });
      } else if (want("replies") && /no thanks|declined|polite no/i.test(reason)) {
        items.push({ kind: "reply", importKey: `reply:state:${String(e.handle).toLowerCase()}`, handle: e.handle, email: e.email || null, market: e.market || null, at, outcome: "declined", source: "state_records", threadRef: (reason.match(/\b(1a1[0-9a-f]{10,})\b/) || [])[1] || null, summary: reason.slice(0, 300) });
      } else if (want("replies") && /soft no/i.test(reason)) {
        items.push({ kind: "reply", importKey: `reply:state:${String(e.handle).toLowerCase()}`, handle: e.handle, email: e.email || null, market: e.market || null, at, outcome: "not_now", source: "state_records", threadRef: null, summary: reason.slice(0, 300) });
      }
    }
  }
  // The one fully-structured narrative reply on file: an interested
  // creator, recorded with her own summary in the TikTok push log.
  const lo = state.tiktok_push_2026_11_03 && state.tiktok_push_2026_11_03.reply_lifeas_lo;
  if (want("replies") && lo && lo.handle && !isExcluded(lo.handle, lo.email)) {
    items.push({ kind: "reply", importKey: `reply:tiktok:${String(lo.handle).toLowerCase()}`, handle: lo.handle, email: lo.email || null, market: "Virginia Beach", at: etToIso(lo.at), outcome: "interested", source: "state_records", threadRef: lo.msg || null, summary: String(lo.summary || "").slice(0, 400) });
  }
}

// ---------- 4b. bounces from the MDS manifest (Gmail scan) ----------
if (want("bounces")) {
  const mp = path.join(CDIR, "outside-import-bounces-2026-11-08.json");
  if (fs.existsSync(mp)) {
    const man = JSON.parse(fs.readFileSync(mp, "utf8"));
    const emailToHandle = {};
    for (const [h, v] of Object.entries(state.sent || {})) if (v && v.email) emailToHandle[String(v.email).toLowerCase()] = h;
    const byEmail = new Map();
    for (const n of man.notices || []) {
      if (!n.recipient || n.class === "delay") continue;
      let cls = n.class;
      if (cls === "unknown") { if (/\(Failure\)/i.test(n.subject || "")) cls = "hard"; else continue; }
      if (!["hard", "soft", "blocked"].includes(cls)) continue;
      if (isExcluded(emailToHandle[n.recipient], n.recipient)) { stats.excluded += 1; continue; }
      const at = n.dateRaw ? new Date(n.dateRaw).toISOString() : null;
      const prev = byEmail.get(n.recipient);
      const cand = { email: n.recipient, cls, at, notice: n };
      if (!prev || (BOUNCE_RANK[cls] || 0) > (BOUNCE_RANK[prev.cls] || 0) || ((BOUNCE_RANK[cls] || 0) === (BOUNCE_RANK[prev.cls] || 0) && at && prev.at && at < prev.at)) byEmail.set(n.recipient, cand);
    }
    for (const { email, cls, at, notice } of byEmail.values()) {
      items.push({ kind: "bounce", importKey: `mds:${email}`, handle: emailToHandle[email] || null, email, market: null, at, bounceClass: cls, enhancedCode: notice.enhancedCode || null, smtpCode: notice.smtpCode || null, noticeId: notice.noticeId || null });
    }
  } else {
    console.log("bounce manifest not found (run the MDS scan first); state-record bounces only");
  }
}

// ---------- 5. forms from Gmail notifications (read-only) ----------
function gmail(args, timeout = 120000) {
  return execFileSync(GMAIL_CLI, ["gmail", ...args], { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
}
const TEST_RE = /test|probe|zzz|delete|example\.com|health/i;
if (want("forms") && !SKIP_GMAIL) {
  const triage = JSON.parse(gmail(["+triage", "--account", GMAIL_ACCT, "--query", "from:formresponses@netlify.com", "--max", "40", "--format", "json"]));
  for (const msg of triage.messages || []) {
    const subj = String(msg.subject || "");
    const fm = subj.match(/Form submission from (.+?) form:/i);
    if (!fm) continue;
    const formType = fm[1].trim();
    const tail = subj.slice(subj.indexOf("form:") + 5).trim();
    let raw = "";
    try { raw = gmail(["+read", "--account", GMAIL_ACCT, "--message-id", msg.id]); } catch (e) { console.log(`form read failed for ${msg.id}: ${e.message}`); continue; }
    const bodyAt = raw.indexOf("Body coverage");
    const body = bodyAt >= 0 ? raw.slice(bodyAt) : raw;
    const fieldsRaw = {};
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim();
      if (/^[A-Z][A-Za-z /&()—-]{2,60}:$/.test(L)) {
        const val = (lines[i + 1] || "").trim();
        if (val && !/^[A-Z][A-Za-z /&()—-]{2,60}:$/.test(val)) fieldsRaw[L.slice(0, -1)] = val;
      }
    }
    const vals = Object.values(fieldsRaw).join(" ");
    if (TEST_RE.test(tail) || TEST_RE.test(vals) || !vals.trim()) { console.log(`form excluded (test/empty): ${msg.id} [${formType}]`); continue; }
    const at = msg.message_sent_at && msg.message_sent_at.utc ? new Date(msg.message_sent_at.utc).toISOString() : null;
    let fields = {};
    if (formType === "city-request") {
      const contact = fieldsRaw["Instagram / TikTok handle or email"] || "";
      const isEmail = /@.+\./.test(contact) && !/\s/.test(contact);
      fields = { city: fieldsRaw["Your city"] || "", region: fieldsRaw["State / Province (if any)"] || fieldsRaw["State"] || "", handle: isEmail ? "" : contact.replace(/^@+/, ""), email: isEmail ? contact.toLowerCase() : "" };
    } else if (formType === "business-application") {
      fields = { businessName: fieldsRaw["Business name"] || "", category: fieldsRaw["Business category"] || fieldsRaw["Category"] || "", type: fieldsRaw["Business type"] || "", contactName: fieldsRaw["Contact name"] || "", email: (fieldsRaw["Email"] || "").toLowerCase(), phone: fieldsRaw["Phone"] || "", city: fieldsRaw["Business city & state"] || "", tierInterest: fieldsRaw["Tier interest"] || "" };
    } else if (formType === "creator-application") {
      fields = { name: fieldsRaw["Your name"] || "", handle: (fieldsRaw["Instagram or TikTok handle"] || "").replace(/^@+/, ""), email: (fieldsRaw["Email"] || "").toLowerCase(), city: fieldsRaw["Home city & state"] || "" };
    } else {
      fields = { city: fieldsRaw["Your city"] || fieldsRaw["City"] || "", email: (fieldsRaw["Email"] || "").toLowerCase(), businessName: fieldsRaw["Business name"] || "" };
    }
    items.push({ kind: "form", importKey: `gmail:${msg.id}`, formType, at, fields, source: "netlify_form", sourceRef: `gmail:${msg.id}` });
  }
} else if (want("forms") && SKIP_GMAIL) {
  console.log("forms step skipped (--skip-gmail)");
}

// ---------- report + POST ----------
const byKind = {};
for (const it of items) byKind[it.kind] = (byKind[it.kind] || 0) + 1;
console.log(`items: ${items.length}`, JSON.stringify(byKind), `| erasure exclusions: ${exclusionRecords} record(s), ${stats.excluded} item(s) excluded`);
if (DRY) {
  console.log("dry run — nothing POSTed. Sample:");
  for (const k of Object.keys(byKind)) console.log(`  ${k}:`, JSON.stringify(items.find((i) => i.kind === k)).slice(0, 320));
  process.exit(0);
}
fs.writeFileSync(path.join(CDIR, "outside-import-items-2026-11-08.json"), JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, items }, null, 1));
if (!TOKEN) { console.error("no sweep token (--token or SIGNL_SWEEP_TOKEN); manifest written, nothing POSTed"); process.exit(2); }
const BATCH = 100;
const totals = {};
for (let i = 0; i < items.length; i += BATCH) {
  const batch = items.slice(i, i + BATCH);
  const res = await fetch(`${BASE}/api/admin/imports/outside`, { method: "POST", headers: { "Content-Type": "application/json", "x-signl-sweep-token": TOKEN }, body: JSON.stringify({ items: batch }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`batch at ${i} failed: HTTP ${res.status}`, JSON.stringify(data).slice(0, 300)); process.exit(1); }
  for (const [k, c] of Object.entries(data.counts || {})) { totals[k] = totals[k] || { received: 0, written: 0, skipped: 0 }; totals[k].received += c.received; totals[k].written += c.written; totals[k].skipped += c.skipped; }
  console.log(`batch ${i / BATCH + 1}: ${batch.length} items ->`, JSON.stringify(data.counts));
}
const joinRes = await fetch(`${BASE}/api/admin/imports/outside`, { method: "POST", headers: { "Content-Type": "application/json", "x-signl-sweep-token": TOKEN }, body: JSON.stringify({ items: [], join: true }) });
const joinData = await joinRes.json().catch(() => ({}));
console.log("TOTALS:", JSON.stringify(totals));
console.log("CONVERSION JOIN:", JSON.stringify(joinData.join));
