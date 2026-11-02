#!/usr/bin/env node
// Build -79 + -80 (Jeff, 2026-11-02, for the Chelsea call):
//
//   -79: a creator's Best Work link that is a video shows the
//   video itself on the profile, click to play, inside SIGNL.
//   One shared parser (lib/video-embed.js, mirrored in
//   public/app.js) turns an Instagram post/reel, a TikTok video,
//   or a YouTube watch/shorts link into the platform embed; any
//   other link keeps the pill/tile it has always had. The
//   descriptor rides every best-work card the API serves and
//   renders on the in-app profile AND the served /c/<handle>
//   page.
//
//   -80: a FOUNDING business gets its business page. The
//   business-home read no longer 403s for founding, and profile
//   field saves (name, category, city, neighborhood, ZIP,
//   about, language, music/student flags, asset packet, moment)
//   round-trip pre-launch, while a transactional write on the
//   same handler (plan-adjacent fields) and campaign publish
//   stay shut for the same account. Active businesses are
//   untouched. The page's own wiring (WYSIWYG live card, the
//   creator-view preview, founding standing stats) is pinned by
//   source checks here and driven in the browser QA pass.
//
// Run: node scripts/verify-build79.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const require = createRequire(import.meta.url);
const { videoEmbedFor } = require(path.join(root, "netlify/functions/lib/video-embed.js"));
const profileMeta = require(path.join(root, "netlify/functions/lib/profile-meta.js"));

const PORT = 8941;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = "admin@signl.test";
const ADMIN_PASSWORD = "<MASKED_SECRET_001>";
const AGREE = { agreedHonestPosts: true, agreedFtcDisclosure: true, agreedPostCompliance: true, agreedTerms: true };

let passed = 0;
let failed = 0;
let currentPart = "boot";
function part(name) { currentPart = name; }
function check(name, cond, extra = "") {
  if (cond) { passed += 1; console.log(`ok   [${currentPart}] ${name}`); }
  else { failed += 1; console.log(`FAIL [${currentPart}] ${name}${extra ? ` :: ${String(extra).slice(0, 400)}` : ""}`); }
}

class Client {
  constructor() { this.cookies = new Map(); }
  async call(method, p, body) {
    const headers = { "Content-Type": "application/json" };
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const sc of setCookie) {
      const [pair] = sc.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }
}
const client = () => { const c = new Client(); return (m, p, b) => c.call(m, p, b); };

const stamp = Date.now().toString(36);

// ---------- the parser ----------
part("parser");
{
  const igPost = videoEmbedFor("https://www.instagram.com/p/DEMOeli01/");
  check("Instagram post parses to the /p/<id>/embed portrait descriptor",
    !!igPost && igPost.embedUrl === "https://www.instagram.com/p/DEMOeli01/embed" && igPost.aspect === "portrait" && igPost.platform === "Instagram", JSON.stringify(igPost));
  const igReel = videoEmbedFor("https://www.instagram.com/reel/DEMOeli02/");
  check("Instagram reel parses to the /reel/<id>/embed descriptor",
    !!igReel && igReel.embedUrl === "https://www.instagram.com/reel/DEMOeli02/embed", JSON.stringify(igReel));
  const igReels = videoEmbedFor("https://instagram.com/reels/AbC_123-xYz");
  check("/reels/ normalizes to /reel/ in the embed URL",
    !!igReels && igReels.embedUrl === "https://www.instagram.com/reel/AbC_123-xYz/embed", JSON.stringify(igReels));
  check("an Instagram profile URL is NOT a video (null)",
    videoEmbedFor("https://www.instagram.com/elithackereats/") === null);
  const tt = videoEmbedFor("https://www.tiktok.com/@elithackereats/video/7300000000000000091");
  check("TikTok video parses to embed/v2/<id>, portrait",
    !!tt && tt.embedUrl === "https://www.tiktok.com/embed/v2/7300000000000000091" && tt.aspect === "portrait" && tt.platform === "TikTok", JSON.stringify(tt));
  check("a TikTok profile URL is NOT a video (null)",
    videoEmbedFor("https://www.tiktok.com/@elithackereats") === null);
  const yt = videoEmbedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  check("YouTube watch parses to the youtube-nocookie embed, wide",
    !!yt && yt.embedUrl === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" && yt.aspect === "wide", JSON.stringify(yt));
  const ytShort = videoEmbedFor("https://youtu.be/dQw4w9WgXcQ");
  check("youtu.be short link parses to the same embed",
    !!ytShort && ytShort.embedUrl === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", JSON.stringify(ytShort));
  const ytS = videoEmbedFor("https://www.youtube.com/shorts/aB3dEf7hIjk");
  check("a YouTube Short parses as portrait",
    !!ytS && ytS.embedUrl === "https://www.youtube-nocookie.com/embed/aB3dEf7hIjk" && ytS.aspect === "portrait", JSON.stringify(ytS));
  check("a Facebook post link falls back (null)", videoEmbedFor("https://www.facebook.com/somepage/posts/123456") === null);
  check("a LinkedIn link falls back (null)", videoEmbedFor("https://www.linkedin.com/posts/someone_activity-123") === null);
  check("a plain website falls back (null)", videoEmbedFor("https://example.com/my-video") === null);
  check("a garbage string falls back (null)", videoEmbedFor("not a url at all") === null);
  check("an empty value falls back (null)", videoEmbedFor("") === null && videoEmbedFor(null) === null);
}

// ---------- the served-page renderer (unit, no server) ----------
part("ssr-work-items");
{
  const p = {
    handle: "unit79", primaryPlatformLabel: "Instagram",
    pastWork: [
      { url: "https://www.instagram.com/reel/DEMOeli02/", label: "Watch: Instagram reel", platform: "Instagram", embed: videoEmbedFor("https://www.instagram.com/reel/DEMOeli02/") },
      { url: "https://www.tiktok.com/@unit79/video/7300000000000000101", label: "Watch: TikTok video", platform: "TikTok" },
      { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", label: "Watch: YouTube video", platform: "YouTube" },
      { url: "https://www.facebook.com/unit79/posts/998877", label: "Watch: Facebook post", platform: "Facebook" },
    ],
  };
  const items = profileMeta.profileWorkItems(p);
  check("three videos become embeds and the non-video link stays a tile",
    items.filter((i) => i.kind === "embed").length === 3 && items.filter((i) => i.kind === "tile").length === 1, JSON.stringify(items.map((i) => i.kind)));
  const html = profileMeta.profileBodyHtml(p);
  check("served profile HTML carries the Instagram embed iframe",
    html.includes('src="https://www.instagram.com/reel/DEMOeli02/embed"'), html.slice(0, 300));
  check("served profile HTML carries the TikTok embed iframe",
    html.includes('src="https://www.tiktok.com/embed/v2/7300000000000000101"'));
  check("served profile HTML carries the YouTube embed iframe",
    html.includes('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"'));
  check("the YouTube cell is wide (16:9), the others portrait",
    /work-cell wide/.test(html) && (html.match(/work-cell"/g) || []).length >= 2, html.slice(0, 200));
  check("the non-video link renders as the fallback tile with its href intact",
    html.includes('class="work-cell tile"') && html.includes('href="https://www.facebook.com/unit79/posts/998877"'));
  check("embed iframes are lazy-loaded and click-to-play (clickable, allow set)",
    html.includes('loading="lazy"') && html.includes("picture-in-picture"));
}

// ---------- source pins for the in-app renderers ----------
part("source-pins");
{
  const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const routerJs = fs.readFileSync(path.join(root, "netlify/functions/lib/router.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "public/theme-v2.css"), "utf8");
  check("app.js carries the mirrored parser and the embed card renderer",
    appJs.includes("function videoEmbedFor(url)") && appJs.includes("bestWorkEmbedCardHtml") && appJs.includes("work-embed-row"));
  check("the API stamps the embed descriptor on best-work cards",
    routerJs.includes("embed: videoEmbedFor(url)") && routerJs.includes('require("./video-embed")'));
  check("embed cards are styled as a scroll-snap row with portrait and wide frames",
    css.includes(".work-embed-row") && css.includes("scroll-snap-type: x mandatory") && css.includes(".work-embed-card.wide"));
  check("work-grid iframes are clickable (no pointer-events lock left on the cell iframe)",
    !/\.work-cell iframe \{[^}]*pointer-events: none/.test(css));
  check("the business page renders the live card helper and binds the WYSIWYG inputs",
    appJs.includes("bizProfileCardHtml") && appJs.includes("bindBizProfileWysiwyg") && appJs.includes('rootId: "biz-profile-live-card"'));
  check("the creator-view preview is a sheet with the same card, not the My Offers tab",
    appJs.includes("openBizProfilePreview") && appJs.includes("biz-preview-sheet") && !appJs.includes(`onclick="return go('dashboard','My Offers')">See it as creators see it`));
  check("founding standing stats (plan, market, Founding) replace the zero counters on the card",
    appJs.includes("<b>Founding</b><span>status</span>"));
  check("the founding allowlist on the profile save names the page fields only",
    routerJs.includes("const PAGE_FIELDS = [\"businessName\", \"category\", \"city\", \"neighborhood\", \"zip\", \"about\""));
}

// ---------- server ----------
const dbFile = path.join(os.tmpdir(), `signl-build79-${stamp}.json`);
const server = spawn(process.execPath, [path.join(root, "scripts/dev-server.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    SIGNL_LOCAL: "1",
    SIGNL_LOCAL_DB: dbFile,
    SIGNL_TEST_ALLOW_BUSINESS: "1",
    SIGNL_MAIL_STUB: "1",
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    SESSION_SECRET: "build79-test-secret",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
async function waitUp() {
  for (let i = 0; i < 160; i += 1) {
    try { const r = await fetch(BASE + "/"); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  check("dev server boots", await waitUp());
  const admin = client();
  const login = await admin("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: "<MASKED_SECRET_001>" });
  check("admin signs in", login.status === 200, JSON.stringify(login.data).slice(0, 200));
  const reviewBiz = async (id) => admin("POST", "/api/admin/review", { userId: id, decision: "approve" });

  // ---------- a creator with video best work ----------
  part("creator-videos");
  const creator = client();
  const cReg = await creator("POST", "/api/auth/register", {
    role: "creator", name: "Vida Videos", handle: `vidacreator${stamp}`, email: `vida${stamp}@fixtures.dev`,
    password: "<MASKED_SECRET_002>", market: "Nashville", city: "Nashville", categories: ["Food & Drink"], localAudiencePct: 88, followerCount: 5200, instagram: `vidacreator${stamp}`,
    ...AGREE,
  });
  check("creator registers", cReg.status === 201, JSON.stringify(cReg.data).slice(0, 200));
  const cId = cReg.data.user.id;
  await admin("POST", "/api/admin/review", { userId: cId, decision: "approve" });
  const cPatch = await creator("PATCH", "/api/me/profile", {
    city: "Nashville", categories: ["Food & Drink"], localAudiencePct: 88, publicPage: true,
    bestWork: [
      "https://www.instagram.com/reel/DEMOvida1/",
      "https://www.tiktok.com/@vidacreator/video/7300000000000000201",
      "https://www.facebook.com/vidacreator/posts/998877",
    ],
  });
  check("creator saves past work with video links", cPatch.status === 200, JSON.stringify(cPatch.data).slice(0, 250));
  const anon = client();
  const pub = await anon("GET", `/api/c/vidacreator${stamp}`);
  const pw = (pub.data && pub.data.profile && pub.data.profile.pastWork) || [];
  check("the public payload stamps embed descriptors on the two video links",
    pw.filter((w) => w.embed && w.embed.embedUrl).length === 2, JSON.stringify(pw).slice(0, 400));
  check("the non-video link carries NO embed descriptor (fallback stays a link)",
    pw.some((w) => /facebook/.test(w.url) && !w.embed), JSON.stringify(pw).slice(0, 300));
  const pageRes = await fetch(`${BASE}/c/vidacreator${stamp}`);
  const pageHtml = await pageRes.text();
  check("served /c/<handle> HTML embeds the Instagram reel in place",
    pageHtml.includes('src="https://www.instagram.com/reel/DEMOvida1/embed"'));
  check("served /c/<handle> HTML embeds the TikTok video in place",
    pageHtml.includes('src="https://www.tiktok.com/embed/v2/7300000000000000201"'));
  check("served /c/<handle> HTML keeps the Facebook link as a tile",
    pageHtml.includes('class="work-cell tile"') && pageHtml.includes("facebook.com/vidacreator/posts/998877"));

  // ---------- -80: the founding business page ----------
  part("founding-page");
  const biz = client();
  const bReg = await biz("POST", "/api/auth/register", {
    role: "business", name: "Chelsea Moubarak", businessName: "Chelsea Friday Furniture", category: "Home & Living",
    email: `chelsea${stamp}@fixtures.dev`, password: "<MASKED_SECRET_002>", market: "Nashville", plan: "self-service", ...AGREE,
  });
  check("founding business registers", bReg.status === 201, JSON.stringify(bReg.data).slice(0, 200));
  const bId = bReg.data.user.id;
  await reviewBiz(bId);
  const home1 = await biz("GET", "/api/me/business-home");
  check("founding business-home loads (200, no founding refusal)",
    home1.status === 200, `${home1.status} ${JSON.stringify(home1.data).slice(0, 200)}`);
  check("business-home carries the real name, plan and market",
    !!home1.data && home1.data.business.name === "Chelsea Friday Furniture" && home1.data.plan && home1.data.plan.id === "self-service" && home1.data.business.market === "Nashville",
    JSON.stringify(home1.data && home1.data.business).slice(0, 300));
  check("business-home reports founding standing (not active)",
    !!home1.data && home1.data.business.accessState === "founding", JSON.stringify(home1.data && home1.data.business).slice(0, 300));

  const newAbout = "Curated liquidation furniture in East Nashville. New pieces every week.";
  const save1 = await biz("PATCH", "/api/me/profile", { about: newAbout, neighborhood: "East Nashville" });
  check("founding profile save (about + neighborhood) succeeds pre-launch",
    save1.status === 200 && !!save1.data.user && save1.data.user.business.about === newAbout && save1.data.user.business.neighborhood === "East Nashville",
    `${save1.status} ${JSON.stringify(save1.data).slice(0, 300)}`);
  const bizAgain = client();
  const login2 = await bizAgain("POST", "/api/auth/login", { email: `chelsea${stamp}@fixtures.dev`, password: "<MASKED_SECRET_002>" });
  check("the saved About round-trips on a fresh sign-in (persisted)",
    login2.status === 200 && !!login2.data.user && login2.data.user.business.about === newAbout,
    JSON.stringify(login2.data && login2.data.user && login2.data.user.business).slice(0, 300));
  const saveBad = await biz("PATCH", "/api/me/profile", { averageTicket: 42 });
  check("a plan-adjacent field on the same handler STILL refuses for founding (403)",
    saveBad.status === 403, `${saveBad.status} ${JSON.stringify(saveBad.data).slice(0, 200)}`);
  const saveBad2 = await biz("PATCH", "/api/me/profile", { monthlyTalentBudget: 500 });
  check("a billing-adjacent field also refuses for founding (403)", saveBad2.status === 403, `${saveBad2.status}`);
  const draft = await biz("POST", "/api/offers", { title: "Founding draft visit", whatComped: "Store tour and styling session", dollarCap: 75, spots: 1 });
  check("founding draft campaign still creates as a draft", draft.status === 201 && draft.data.offer.status === "draft", `${draft.status} ${JSON.stringify(draft.data).slice(0, 200)}`);
  const pub1 = await biz("POST", `/api/offers/${draft.data.offer.id}/publish`, {});
  check("campaign publish STILL refuses for the same founding business (403)",
    pub1.status === 403, `${pub1.status} ${JSON.stringify(pub1.data).slice(0, 200)}`);

  part("active-unchanged");
  const abiz = client();
  const aReg = await abiz("POST", "/api/auth/register", {
    role: "business", name: "Active Owner", businessName: "Active Eats", category: "Food & Drink",
    email: `active${stamp}@fixtures.dev`, password: "<MASKED_SECRET_002>", market: "Nashville", plan: "growth", ...AGREE,
  });
  await reviewBiz(aReg.data.user.id);
  const act = await admin("POST", "/api/admin/businesses/activate", { userId: aReg.data.user.id });
  check("admin activates the second business", act.status === 200, JSON.stringify(act.data).slice(0, 200));
  const aHome = await abiz("GET", "/api/me/business-home");
  check("active business-home unchanged (200, active standing)",
    aHome.status === 200 && aHome.data.business.accessState === "active", `${aHome.status}`);
  const aSave = await abiz("PATCH", "/api/me/profile", { about: "Active about.", averageTicket: 42 });
  check("active business keeps its unrestricted profile save (plan fields included)",
    aSave.status === 200 && aSave.data.user.business.averageTicket === 42, `${aSave.status} ${JSON.stringify(aSave.data).slice(0, 250)}`);
} finally {
  server.kill("SIGTERM");
  try { fs.unlinkSync(dbFile); } catch {}
}

console.log(`\nverify-build79: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
