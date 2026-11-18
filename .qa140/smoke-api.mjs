// Build -140 API smoke: platform links, per-platform local %,
// the R recompute, geo award once, per-platform award once,
// Sig chips. Boots the dev server on a temp DB.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP = path.expanduser ? path.expanduser("~/workspace/signl-app") : "/home/hatch/workspace/signl-app";
const PORT = 9140;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = "qa-pass-140";
const SALT = "qa140salt";
const HASH = execFileSync("node", ["-e", "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))", PW, SALT]).toString().trim();

function creator(uid, email, name, handle, cextra = {}) {
  const c = {
    handle, platform: "Instagram", handleNormalized: handle,
    city: "Virginia Beach", categories: ["Food & Drink"], tierBand: "Locals",
    compCategories: ["Restaurant meals"], followerCount: 10000,
    audienceStack: { instagram: 10000, tiktok: 40000 }, totalAudience: 50000,
    localAudiencePct: null, paidRate: 150, compOpen: true, couponOpen: true,
    profileComplete: true, publicPage: true, bio: `${name} — local.`,
    instagramUrl: `https://instagram.com/${handle}`,
    tiktokHandle: `${handle}tt`, tiktokUrl: `https://www.tiktok.com/@${handle}tt`,
    ...cextra,
  };
  return { id: uid, passwordHash: HASH, passwordSalt: SALT, status: "approved",
    createdAt: "2026-09-01T00:00:00.000Z", tester: false, role: "creator",
    email, name, city: "Virginia Beach", market: "Hampton Roads", creator: c };
}
const data = {};
data["user:crgeo"] = creator("crgeo", "geo@qa140.dev", "Gia Geo", "giageo");
data["user:crfresh"] = creator("crfresh", "fresh@qa140.dev", "Fred Fresh", "fredfresh");
for (const uid of ["crgeo", "crfresh"]) data[`email:${data["user:" + uid].email}`] = { userId: uid };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "signl-qa140-"));
const dbpath = path.join(tmp, "db.json");
fs.writeFileSync(dbpath, JSON.stringify(data));
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: dbpath, SIGNL_MAIL_STUB: "1", APP_URL: BASE };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: "/home/hatch/workspace/signl-app", env, stdio: "ignore" });

let fails = 0;
const ck = (name, cond, extra = "") => { console.log((cond ? "  ok " : "FAIL ") + name + (cond ? "" : " :: " + extra)); if (!cond) fails++; };
async function login(email) {
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  const cookie = r.headers.get("set-cookie");
  if (!r.ok || !cookie) throw new Error("login " + email + " " + r.status);
  return cookie;
}
async function call(cookie, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

try {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + "/api/bootstrap"); if (r.ok) break; } catch (e) { await new Promise((s) => setTimeout(s, 250)); } }

  const ck1 = await login("geo@qa140.dev");
  // 1) Complete the breakdown: IG rate + market splits.
  let r = await call(ck1, "PATCH", "/api/me/profile", {
    localAudiencePct: 82,
    platformLocalPct: { instagram: 82 },
    audienceMarkets: [{ market: "Richmond", pct: 12 }],
    platformLinks: [{ platform: "pinterest", handle: "giageo", url: "https://www.pinterest.com/giageo" }],
    audienceStack: { instagram: 10000, tiktok: 40000, pinterest: 3000 },
  });
  ck("PATCH ok", r.status === 200, JSON.stringify(r.json).slice(0, 200));
  ck("geoAward fires on the completing save (+10)", r.json.geoAward && r.json.geoAward.points === 10, JSON.stringify(r.json.geoAward));
  ck("headline % = R = 82 (TikTok 40k unrated does not dilute)", r.json.user.creator.localAudiencePct === 82, String(r.json.user.creator.localAudiencePct));
  const mom1 = r.json.user.momentum || {};
  ck("ledger carries geo_breakdown +10", (mom1.ledger || []).some((e) => e.kind === "geo_breakdown" && e.points === 10), JSON.stringify((mom1.ledger || []).map((e) => e.kind)));
  ck("checklist geo row done", (mom1.checklist || []).some((x) => x.id === "geo" && x.done === true), JSON.stringify((mom1.checklist || []).map((x) => x.id + ":" + x.done)));
  const pts1 = mom1.points;

  // 2) Re-save identical: no award flags, points unchanged (not farmable).
  r = await call(ck1, "PATCH", "/api/me/profile", {
    localAudiencePct: 82,
    platformLocalPct: { instagram: 82 },
    audienceMarkets: [{ market: "Richmond", pct: 12 }],
    platformLinks: [{ platform: "pinterest", handle: "giageo", url: "https://www.pinterest.com/giageo" }],
    audienceStack: { instagram: 10000, tiktok: 40000, pinterest: 3000 },
  });
  ck("re-save: no geoAward flag", !r.json.geoAward, JSON.stringify(r.json.geoAward));
  ck("re-save: momentum points unchanged", r.json.user.momentum.points === pts1, `${pts1} -> ${r.json.user.momentum.points}`);

  // 3) TikTok rate first time: per-platform award; R stays 82 (matched only).
  r = await call(ck1, "PATCH", "/api/me/profile", {
    platformLocalPct: { instagram: 82, tiktok: 10 },
  });
  ck("localRateAwards fires for TikTok (+10)", Array.isArray(r.json.localRateAwards) && r.json.localRateAwards.length === 1 && r.json.localRateAwards[0].platform === "tiktok" && r.json.localRateAwards[0].points === 10, JSON.stringify(r.json.localRateAwards));
  ck("R still 82 after TikTok rate (matched channels rule the %)", r.json.user.creator.localAudiencePct === 82, String(r.json.user.creator.localAudiencePct));
  ck("ledger carries local_rate_tiktok +10 once", (r.json.user.momentum.ledger || []).filter((e) => e.kind === "local_rate_tiktok").length === 1, "");
  const pts2 = r.json.user.momentum.points;
  ck("points grew by exactly the TikTok award", pts2 === pts1 + 10, `${pts1} -> ${pts2}`);

  // 4) Clear + re-add TikTok rate: no second award, points do not grow again.
  r = await call(ck1, "PATCH", "/api/me/profile", { platformLocalPct: { instagram: 82 } });
  r = await call(ck1, "PATCH", "/api/me/profile", { platformLocalPct: { instagram: 82, tiktok: 10 } });
  ck("re-added rate: no second award flag", !r.json.localRateAwards, JSON.stringify(r.json.localRateAwards));
  ck("re-added rate: points unchanged", r.json.user.momentum.points === pts2, `${pts2} -> ${r.json.user.momentum.points}`);

  // 5) Sig home: incomplete creator gets the under-counted prompt.
  const ck2 = await login("fresh@qa140.dev");
  r = await call(ck2, "GET", "/api/sig/home");
  const chips = (r.json.chips || []).join(" | ");
  ck("Sig chip names what is missing + why + points", /under-counted/.test(chips) && /Instagram/.test(chips) && /\+10 Momentum/.test(chips), chips.slice(0, 300));

  // 6) Sig home: complete-but-unfilled creator gets the estimated-platforms prompt.
  r = await call(ck1, "GET", "/api/sig/home");
  const chips1 = (r.json.chips || []).join(" | ");
  ck("Sig chip names unfilled platforms (Pinterest) as estimated", /Pinterest/.test(chips1) && /no local % yet/.test(chips1), chips1.slice(0, 300));
  ck("Sig geo completion chip silent once complete", !/under-counted/.test(chips1), chips1.slice(0, 200));
} finally {
  server.kill();
}
console.log(fails ? `\nSMOKE: ${fails} failures` : "\nSMOKE: all ok");
process.exit(fails ? 1 : 0);
