#!/usr/bin/env node
// Two-tap invite verification (Jeff, 2026-10-26).
//
// The homepage promises a business can invite a creator in two
// taps. That is only true if the DIRECT composer opens
// submittable: tap 1 = Invite on the card, tap 2 = Publish. This
// suite pins the prefill contract:
//   (a) a fresh direct composer is prefilled from the tier's
//       lead comp suggestion (title = the suggestion label,
//       comped + cap = the suggestion), on the lane defaults
//       (kind comp, window 7 days, spots 1), and the exact
//       payload that prefilled form submits is accepted by the
//       API with no further input, for every tier;
//   (b) a non-empty in-progress draft is never overwritten:
//       the prefill only fires when the draft is empty;
//   (c) the preview twin's direct composer opens with the same
//       prefilled state (same suggestion, chip selected).
// Client behavior is pinned at the source (the suites' standing
// pattern for app.js) and the payloads are proven against the
// real API on a throwaway DB.
//
// Run: node scripts/verify-two-tap.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const PORT = 8995;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok [${currentPart}] ${name}`); }
  else { failed++; console.error(`FAIL [${currentPart}] ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-twotap-"));
const dbFile = path.join(tmp, "db.json");
let server = null;

function startServer() {
  server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: root,
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbFile, SIGNL_TEST_ALLOW_BUSINESS: "1", APP_URL: BASE, ADMIN_EMAIL, ADMIN_PASSWORD },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
}
async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 400));
  server = null;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/bootstrap`); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not come up");
}

function makeClient() {
  const jar = new Map();
  return async function api(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) for (const part of setCookie.split(/,(?=[^;]+=)/)) {
      const m = part.trim().match(/^([^=]+)=([^;]*)/);
      if (m) { if (m[2]) jar.set(m[1], m[2]); else jar.delete(m[1]); }
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* html error page */ }
    return { status: res.status, data, text };
  };
}

const uniq = () => Math.random().toString(36).slice(2, 9);
let n = 0;
async function registerCreator(admin, followerCount) {
  n += 1;
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", {
    role: "creator",
    name: `Two Tap Creator ${n}`,
    email: `tap${n}-${uniq()}@fixtures.dev`,
    password: "<redacted>",
    market: "Hampton Roads",
    city: "Norfolk",
    handle: `tap${n}${uniq()}`,
    categories: ["Food & Drink"],
    compCategories: ["Restaurant meals"],
    tierBand: "Locals",
    followerCount,
    avgViews: 900,
    localAudiencePct: 62,
    bio: "",
    agreedHonestPosts: true,
    agreedFtcDisclosure: true,
    agreedPostCompliance: true,
    agreedTerms: true,
  });
  if (r.status === 201) await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
  return { client: c, res: r, user: r.data && r.data.user };
}
async function registerBusiness(admin, planId, businessName) {
  const c = makeClient();
  const r = await c("POST", "/api/auth/register", {
    role: "business",
    name: "Biz Owner",
    email: `biz-${uniq()}@fixtures.dev`,
    password: "<redacted>",
    market: "Hampton Roads",
    city: "Norfolk",
    businessName,
    category: "Restaurant",
    planId,
    agreedTerms: true,
  });
  if (r.status === 201) {
    await admin("POST", "/api/admin/review", { userId: r.data.user.id, decision: "approve" });
    await admin("POST", "/api/admin/businesses/activate", { userId: r.data.user.id });
  }
  return { client: c, res: r, user: r.data && r.data.user };
}
async function adminClient() {
  const c = makeClient();
  const r = await c("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (r.status !== 200) throw new Error("admin login failed: " + r.status);
  return c;
}

// The exact payload createOfferV2 submits for a prefilled direct
// comp offer: prefilled title/comped/cap, lane defaults for the
// rest (spots unset -> 1, window note empty, covers 1, window
// mode 7days, kind comp).
function prefilledPayload(creatorId, s) {
  return {
    title: s.title,
    whatComped: s.comped,
    includes: "",
    experience: "",
    kind: "comp",
    spots: 1,
    visitWindow: "",
    templateId: null,
    draft: false,
    creatorId,
    dollarCap: s.cap,
    covers: 1,
    windowMode: "7days",
  };
}

try {
  const appJs = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

  part("source: prefill wiring");
  check("startOffer prefills from the tapped creator", appJs.includes("prefillDirectDraft((state.discover || []).find((x) => x.userId === creatorId))"));
  check("prefill fills title + comped + cap from the tier's lead suggestion and sets the comp lane", appJs.includes("state.offerDraft.title = s.label") && appJs.includes("state.offerDraft.comped = s.comp") && appJs.includes("state.offerDraft.cap = String(s.cap)") && appJs.includes('state.offerDraft.kind = "comp"'));
  check("the lead suggestions are the pinned defaults (Neighbors: Meal for one $50; Locals: Meal for two $100; Headliners: Experience for two $175)",
    appJs.includes('label: "Meal for one", comp: "Meal for one, on us", cap: 50') &&
    appJs.includes('label: "Meal for two", comp: "Meal for two, on us", cap: 100') &&
    appJs.includes('label: "Experience for two", comp: "Experience for two, on us", cap: 175'));
  check("the prefilled suggestion's chip renders selected, and chip taps move the selection", appJs.includes('data-compchip="${prefix}"') && appJs.includes('current.comp === s.comp && Number(current.cap) === s.cap ? " on" : ""') && appJs.includes('b.classList.toggle("on", b.dataset.comp === comp && Number(b.dataset.cap) === Number(cap))'));
  check("the live composer passes its draft values as the chips' current state", appJs.includes('chipsRowHtml("comp", "o2", target && target.profile ? target.profile.tierBand : null, { comp: dft.comped, cap: dft.cap })'));
  check("lane defaults hold in the form (comp kind prechecked, spots optional-empty, window 7 days)", appJs.includes('name="o2-kind" value="comp"') && appJs.includes('if (v === "") return offerFieldError("spots", "");') && appJs.includes('windowModeFieldHtml("o2", dft.windowmode)'));

  part("(b) source: an in-progress draft is never overwritten");
  check("prefill refuses to fire on a non-empty draft", appJs.includes("if (!creator || !offerDraftIsEmpty()) return false;"));
  check("emptiness is judged on the typed fields, not on lane toggles", appJs.includes('!["title", "comped", "cap", "rate", "brief", "includes", "experience", "spots", "window", "windowdays", "applydays"].some('));

  part("(c) source: preview parity");
  check("the preview composer computes the same lead suggestion for its target", appJs.includes("const pvSug = target ? compSuggestions(target.profile ? target.profile.tierBand : null)[0] : null;"));
  check("the preview form opens with title, comped and cap prefilled and the chip selected", appJs.includes('value="${esc(pvSug.label)}"') && appJs.includes('value="${esc(pvSug.comp)}"') && appJs.includes('value="${pvSug.cap}"') && appJs.includes("pvSug ? { comp: pvSug.comp, cap: pvSug.cap } : null"));

  part("(a) api: the prefilled payload submits as-is, every tier");
  startServer();
  await waitUp();
  const admin = await adminClient();
  const bizReg = await registerBusiness(admin, "growth", "Two Tap Kitchen");
  const bizC = bizReg.client;
  check("business registered + activated", bizReg.res.status === 201, JSON.stringify(bizReg.res.data).slice(0, 150));
  const tiers = [
    { band: "Neighbors", followers: 900, s: { title: "Meal for one", comped: "Meal for one, on us", cap: 50 } },
    { band: "Locals", followers: 3000, s: { title: "Meal for two", comped: "Meal for two, on us", cap: 100 } },
    { band: "Headliners", followers: 25000, s: { title: "Experience for two", comped: "Experience for two, on us", cap: 175 } },
  ];
  for (const t of tiers) {
    const c = await registerCreator(admin, t.followers);
    check(`${t.band} creator lands in the ${t.band} tier`, !!c.user && c.user.creator.tierBand === t.band, JSON.stringify(c.user && c.user.creator && c.user.creator.tierBand));
    const off = await bizC("POST", "/api/offers", prefilledPayload(c.user.id, t.s));
    check(`${t.band}: the prefilled direct offer submits with no further input (201, open, direct)`, off.status === 201 && off.data.offer.title === t.s.title && off.data.offer.whatComped === t.s.comped && off.data.offer.dollarCap === t.s.cap && off.data.offer.windowMode === "7days" && off.data.offer.spots === 1 && off.data.offer.status === "open" && off.data.offer.lane === "direct" && off.data.offer.creatorId === c.user.id, `${off.status} ${JSON.stringify(off.data).slice(0, 250)}`);
  }
} catch (err) {
  failed++;
  console.error("SUITE ERROR:", err && err.stack || err);
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nTwo-tap invite verification: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
