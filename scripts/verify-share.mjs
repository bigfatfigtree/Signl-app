// Verification of one-tap referral sharing (Jeff, 2026-10-21,
// narrow scope): the payload builder and fallback menu are
// exercised by evaluating the actual client functions extracted
// from public/app.js; placement is asserted per surface (exactly
// four call sites: dashboard roster block, founding status
// surface, profile-completion moment, public /c/ profile); an
// HTTP pass confirms the /c/ payload carries the owner's handle
// and market the share consumes.
// Run: node scripts/verify-share.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8943;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = "jeff@joinsignl.com";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";
const DB = path.join(os.tmpdir(), `signl-verify-share-${Date.now()}.json`);

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  FAIL  ${name}${extra ? " :: " + extra : ""}`); }
}

function client() {
  const jar = new Map();
  return async function call(method, p, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
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
const appJs = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "public", "app.js"), "utf8");

// ---------- payload + menu behavior, from the real client code ----------
function extractFn(name) {
  const start = appJs.indexOf(`function ${name}(`);
  if (start < 0) return "";
  let depth = 0;
  let end = start;
  for (let i = appJs.indexOf("{", start); i < appJs.length; i++) {
    if (appJs[i] === "{") depth++;
    else if (appJs[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return appJs.slice(start, end);
}
const escStub = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sandbox = { encodeURIComponent, esc: escStub, navigator: {}, document: {} };
const vm = await import("node:vm");
const ctx = vm.createContext(sandbox);
vm.runInContext([extractFn("sharePayloadFor"), extractFn("shareBlockHtml"), extractFn("shareInvite"), extractFn("copyShareLink")].join("\n"), ctx);

try {
  const payload = ctx.sharePayloadFor("Hampton Roads", "sharer757");
  check("share payload is the creator referral link", payload.url === "https://app.joinsignl.com/?ref=sharer757", payload.url);
  check("share payload text is the founding-status line naming the market", payload.text === "I just became a founding creator on SIGNL in Hampton Roads. Local businesses comp creators for honest posts, and it is free for creators. Claim your spot:", payload.text);
  const named = ctx.sharePayloadFor("Richmond", "ownerhandle", "Casey Rivers");
  check("public-profile payload names the creator and still uses the owner's ref link", named.url === "https://app.joinsignl.com/?ref=ownerhandle" && named.text.startsWith("Casey Rivers is a founding creator on SIGNL in Richmond."), JSON.stringify(named));

  const block = ctx.shareBlockHtml("sharer757", "Hampton Roads", "Share your invite");
  check("fallback menu renders copy, Facebook, X, and WhatsApp", block.includes("Copy link") && block.includes("facebook.com/sharer/sharer.php?u=") && block.includes("twitter.com/intent/tweet") && block.includes("wa.me/?text="), block.slice(0, 200));
  check("fallback menu carries the referral link in every share target", block.includes(encodeURIComponent("https://app.joinsignl.com/?ref=sharer757")), "");
  check("share button carries handle and place for the tap handler", block.includes('data-share-handle="sharer757"') && block.includes('data-share-place="Hampton Roads"'), "");

  const menu = { style: { display: "none" } };
  const fakeBtn = {
    getAttribute: (k) => ({ "data-share-handle": "sharer757", "data-share-place": "Hampton Roads", "data-share-name": "" }[k] || ""),
    parentElement: { querySelector: (sel) => (sel === ".share-menu" ? menu : null) },
  };
  const ret = ctx.shareInvite(fakeBtn);
  check("without navigator.share the fallback menu opens", ret === false && menu.style.display === "block", String(menu.style.display));

  let sharedPayload = null;
  ctx.navigator.share = (p) => { sharedPayload = p; return Promise.resolve(); };
  ctx.shareInvite(fakeBtn);
  check("with navigator.share the payload is handed to the share sheet", !!sharedPayload && sharedPayload.url === "https://app.joinsignl.com/?ref=sharer757" && sharedPayload.text.includes("Hampton Roads"), JSON.stringify(sharedPayload));
  ctx.navigator.share = undefined;

  // ---------- placement: exactly the four approved surfaces ----------
  const blockCalls = (appJs.match(/shareBlockHtml\(/g) || []).length;
  check("share block has exactly four placements plus its definition", blockCalls === 5, String(blockCalls));
  const bodyOf = (fnName) => { const src = extractFn(fnName); return src; };
  check("placement 1: dashboard roster block", bodyOf("growRosterHtml").includes("shareBlockHtml("), "");
  check("placement 2: founding status (approval) surface", bodyOf("loadFoundingStatus").includes("shareBlockHtml("), "");
  check("placement 3: profile-completion moment fires only on the flip to complete", appJs.includes('id="profile-complete-share"') && bodyOf("doUpdateCreator").includes("profile-complete-share") && bodyOf("doUpdateCreator").includes("!wasProfileComplete && nowComplete"), "");
  check("placement 4: public /c/ profile shares the owner's link", bodyOf("renderPublicProfile").includes("shareBlockHtml(p.handle"), "");
  check("the existing invite-link copy flow is untouched in the roster block", bodyOf("growRosterHtml").includes('onclick="this.select()"'), "");
  check("no share buttons were added to the site or other app surfaces", !appJs.includes("shareBlockHtml(state") && !bodyOf("renderHome").includes("shareBlockHtml(") && !bodyOf("renderPending").includes("shareBlockHtml("), "");

  // ---------- HTTP: the /c/ payload carries what the share needs ----------
  const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], {
    cwd: path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
    env: { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, SIGNL_TEST_ALLOW_BUSINESS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  try {
    check("dev server comes up", await waitForServer());
    const admin = client();
    await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const creator = client();
    const reg = await creator("POST", "/api/auth/register", {
      role: "creator", name: "Share Owner", email: "shareowner@example.com", password: "<MASKED_SECRET_002>",
      market: "Hampton Roads", city: "Norfolk", handle: "shareowner",
      followerCount: 5100, localAudiencePct: 70, categories: ["Food & Drink"], ...AGREE,
    });
    const ownerId = reg.data.user.id;
    await admin("POST", "/api/admin/review", { userId: ownerId, decision: "approve" });
    const pub = await client()("GET", "/api/c/shareowner");
    check("public /c/ payload carries the owner's handle and market for the share", pub.status === 200 && pub.data.profile.handle === "shareowner" && pub.data.profile.market === "Hampton Roads", JSON.stringify(pub.data.profile && { handle: pub.data.profile.handle, market: pub.data.profile.market }));
    const servedJs = await (await fetch(BASE + "/app.js")).text();
    check("the served app ships the share block on the public profile", servedJs.includes("shareBlockHtml(p.handle"), "");
  } finally {
    server.kill("SIGKILL");
    try { fs.unlinkSync(DB); } catch (e) { /* ignore */ }
  }
} catch (e) {
  failed += 1;
  failures.push("suite error: " + e.message);
  console.log("  FAIL  suite error: " + e.message);
}

console.log(`\nverify-share: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
