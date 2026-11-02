#!/usr/bin/env node
// Build -72 verification (Jeff, 2026-11-02): the staff-recruiter
// seed import must never block a read, and it must be resumable.
//
// The production bug: GET /admin/recruiters awaited the full
// ~1,300-record seed import before answering, so on the
// Blobs-backed store the request ran past the function timeout
// and Jeff's "Invite a staff recruiter" form never rendered.
//
// Proves, against a throwaway local store (in-process, no
// listening socket, so this suite is cage-proof):
//   (a) GET /admin/recruiters answers on a fresh store while the
//       seed import is still pending, carrying recruiters +
//       markets fields;
//   (b) POST /admin/recruits/invite succeeds before the seeds
//       complete, and the invited recruiter's /recruiter/me (and
//       /queue) respond;
//   (c) once drained, every seed file has its own done flag plus
//       the global flag; deleting one file's flag (and the
//       global) and triggering a normal read re-imports ONLY that
//       file (finished files' flags untouched, prospect total
//       unchanged: resume, not restart);
//   (d) source: no read path in recruiters.js awaits ensureSeeds
//       (only the explicit seed POST may), the router leaderboard
//       warms the seeds, and app.js paints the invite form
//       synchronously before the GET promise inside
//       loadStaffRecruiters.
//
// Run: node scripts/verify-build72.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const require = createRequire(import.meta.url);

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ok - ${name}`); }
  else { failed++; fails.push(name); console.error(`FAIL - ${name}${extra ? " :: " + String(extra).slice(0, 300) : ""}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-build72-"));
const DB = path.join(tmp, "db.json");
process.env.SIGNL_LOCAL = "1";
process.env.SIGNL_LOCAL_DB = DB;
process.env.SIGNL_TEST_ALLOW_BUSINESS = "1";
process.env.SIGNL_MAIL_STUB = "1";
process.env.APP_URL = "http://127.0.0.1:8999";
process.env.ADMIN_EMAIL = "admin@signl.test";
process.env.ADMIN_PASSWORD = "build-72-admin-password";

const { handler } = require("../netlify/functions/api.js");
const store = require("../netlify/functions/lib/store.js");

class DirectClient {
  constructor() { this.cookies = new Map(); }
  async req(method, p, body) {
    const url = new URL("http://local" + p);
    const headers = { "content-type": "application/json" };
    if (this.cookies.size) headers.cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const event = {
      httpMethod: method,
      path: "/api" + url.pathname,
      headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: body ? JSON.stringify(body) : null,
      isBase64Encoded: false,
    };
    const out = await handler(event);
    const sc = out.headers && (out.headers["Set-Cookie"] || out.headers["set-cookie"]);
    if (sc) {
      const [pair] = String(sc).split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    let data = null;
    try { data = JSON.parse(out.body); } catch (e) { /* no body */ }
    return { status: out.statusCode, data };
  }
}

const FILE_FLAG = (slug) => `config:recruiterSeedFile:${slug}`;
const SLUGS = ["dubai", "brain", "austin", "denver", "dallas", "chicago"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return true;
    await sleep(500);
  }
  console.error(`  (waitFor timed out: ${label})`);
  return false;
}

const admin = new DirectClient();
{
  const r = await admin.req("POST", "/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  check("admin login", r.status === 200 && r.data.user && r.data.user.role === "admin", `status=${r.status}`);
}

// (a) The rollup read answers from a fresh store, seeds pending.
{
  const r = await admin.req("GET", "/admin/recruiters");
  check("(a) GET /admin/recruiters responds on a fresh store", r.status === 200, `status=${r.status}`);
  check("(a) response carries the recruiters field", Array.isArray(r.data && r.data.recruiters));
  check("(a) response carries the markets field, Dubai included",
    Array.isArray(r.data && r.data.markets) && r.data.markets.some((m) => m.name === "Dubai"),
    r.data && `markets=${(r.data.markets || []).length}`);
  const globalFlag = await store.get("config:recruiterSeedsV1");
  check("(a) the read did not wait for the import to finish (global seed flag still unset when it answered)", !globalFlag);
}

// (b) The invite lands while the import is still draining.
let bella = new DirectClient();
{
  const r = await admin.req("POST", "/admin/recruiters/invite", { name: "Bella Hausen", email: "bella72@fixtures.dev", market: "Dubai" });
  check("(b) invite succeeds before seeds complete", r.status === 200 && !!r.data.recruiter && r.data.recruiter.marketName === "Dubai", `status=${r.status}`);
  let allFlagsDown = true;
  for (const slug of SLUGS) { if (!(await store.get(FILE_FLAG(slug)))) { allFlagsDown = false; break; } }
  check("(b) the seed import was still incomplete when the invite landed", !allFlagsDown);
  const reset = await bella.req("POST", "/auth/reset", { token: r.data.devResetToken, password: "bella-own-password-72" });
  check("(b) Bella sets her own password from the invite", reset.status === 200, `status=${reset.status}`);
  const login = await bella.req("POST", "/auth/login", { email: "bella72@fixtures.dev", password: "bella-own-password-72" });
  check("(b) Bella signs in", login.status === 200 && login.data.user.role === "recruiter", `status=${login.status}`);
  const me = await bella.req("GET", "/recruiter/me");
  check("(b) the invited recruiter's /recruiter/me responds", me.status === 200 && !!me.data.recruiter && me.data.recruiter.marketName === "Dubai" && me.data.recruiter.kind === "staff", `status=${me.status}`);
  const q = await bella.req("GET", "/recruiter/queue");
  check("(b) the invited recruiter's /recruiter/queue responds while seeds drain", q.status === 200 && q.data.market === "Dubai" && !!q.data.counts, `status=${q.status}`);
}

// (c) Drain fully, then prove per-file resume.
{
  const drained = await waitFor(async () => !!(await store.get("config:recruiterSeedsV1")), 600000, "global seed flag");
  check("(c) the background import drains to completion (global flag set)", drained);
  let flagsOk = true;
  for (const slug of SLUGS) { if (!(await store.get(FILE_FLAG(slug)))) flagsOk = false; }
  check("(c) every seed file stamped its own done flag", flagsOk);
  const dubai = (await store.list("prospect:")).map((x) => x.value).filter((p) => p.marketName === "Dubai");
  check("(c) Dubai seed landed (>= 200 of 216)", dubai.length >= 200, `dubai=${dubai.length}`);
  const totalBefore = (await store.list("prospect:")).length;
  check("(c) full import present (> 1,200 prospects)", totalBefore > 1200, `total=${totalBefore}`);

  // Surgery: pretend an invocation died after Chicago's file but
  // before the global flag. A normal read must resume ONLY that
  // file: finished files keep their original flag timestamps and
  // the prospect total does not move (dedupe idempotence).
  const dubaiFlagAt = (await store.get(FILE_FLAG("dubai"))).at;
  const chicagoFlagAt = (await store.get(FILE_FLAG("chicago"))).at;
  await store.del("config:recruiterSeedsV1");
  await store.del(FILE_FLAG("chicago"));
  await admin.req("GET", "/admin/recruiters");
  const resumed = await waitFor(async () => !!(await store.get(FILE_FLAG("chicago"))) && !!(await store.get("config:recruiterSeedsV1")), 300000, "chicago resume");
  check("(c) the missing file resumes on a later read and the global flag re-seals", resumed);
  const dubaiFlagAfter = await store.get(FILE_FLAG("dubai"));
  check("(c) finished files were skipped, not re-imported (Dubai flag timestamp unchanged)", !!dubaiFlagAfter && dubaiFlagAfter.at === dubaiFlagAt, dubaiFlagAfter && dubaiFlagAfter.at);
  const chicagoFlagAfter = await store.get(FILE_FLAG("chicago"));
  check("(c) the resumed file re-stamped its flag", !!chicagoFlagAfter && chicagoFlagAfter.at !== chicagoFlagAt);
  const totalAfter = (await store.list("prospect:")).length;
  check("(c) resume added no duplicates (prospect total unchanged)", totalAfter === totalBefore, `before=${totalBefore} after=${totalAfter}`);
}

// (d) Source checks: the mechanism itself.
{
  const recJs = fs.readFileSync(path.join(root, "netlify/functions/lib/recruiters.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  const awaits = recJs.match(/await ensureSeeds\([^)]*\)/g) || [];
  check("(d) the only awaited seed call left in recruiters.js is the explicit seed POST (force)", awaits.length === 1 && awaits[0] === "await ensureSeeds(true)", awaits.join(" | "));
  check("(d) read paths kick the seeds fire-and-forget (>= 4 kickSeeds call sites)", (recJs.split("kickSeeds();").length - 1) >= 4, `sites=${recJs.split("kickSeeds();").length - 1}`);
  check("(d) per-file seed flags exist in the seeder", recJs.includes("config:recruiterSeedFile:") && recJs.includes("seedFileFlagKey"));
  check("(d) the router leaderboard warms the seeds", routerJs.includes("recruiters.ensureSeeds()"));
  const fnStart = appJs.indexOf("async function loadStaffRecruiters");
  const fnEnd = appJs.indexOf("async function srInvite", fnStart);
  const fnBody = fnStart >= 0 && fnEnd > fnStart ? appJs.slice(fnStart, fnEnd) : "";
  check("(d) loadStaffRecruiters found for inspection", fnBody.length > 0);
  check("(d) the invite form paints before the GET promise inside loadStaffRecruiters",
    fnBody.indexOf("srInvitePanelHtml(srMarketOptionsHtml(bootNames") >= 0 &&
    fnBody.indexOf("el.innerHTML") < fnBody.indexOf('api("GET", "/admin/recruiters")'));
  check("(d) the first paint falls back to a static market list with Dubai preselected",
    appJs.includes("SR_FALLBACK_MARKET_NAMES") && fnBody.includes('SR_FALLBACK_MARKET_NAMES, "Dubai"'));
  check("(d) typed form values survive the rollup render", fnBody.includes("typedName") && fnBody.includes("typedEmail") && fnBody.includes("typedMarket"));
  check("(d) package.json wires verify-build72", pkg.includes("verify-build72"));
}

console.log(`\nBuild -72: ${passed} passed, ${failed} failed`);
if (fails.length) console.log("Failures:\n - " + fails.join("\n - "));
process.exit(failed ? 1 : 0);
