#!/usr/bin/env python3
"""Landing-pass rendered sanity (2026-11-04 batch: -121 + -122/-124/-125 + -123):
- Signed-out sign-in screen at 390px with NO Google env set (production
  behavior): the Sign in control must be near-black (Build -122), and the
  "Continue with Google" button must be ABSENT (Build -123 env gating).
- One signed-in creator shell view at 390px (photo avatar in the identity
  circle, Build -122; Sig Concept A art, Build -124).
- The Everything panel opens from the top-right button (Build -125).
Chromium runs through the local relay (127.0.0.1:8899) with loopback
bypassed, per the standing QA chain.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-landing-qa-2026-11-04")
os.makedirs(OUT, exist_ok=True)
PORT = 9077
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-landing-qa-")
db = os.path.join(tmp, "db.json")
PW = "qa-pass-1234"

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const put = (key, val) => { data[key] = val; };
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
put("config:markets", { flags: { Nashville: true } });
putUser({ id: "cara", role: "creator", email: "cara@landingqa.dev", name: "Cara Creators", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 40 * DAY), updatedAt: iso(now0 - 2 * DAY), reviewedAt: iso(now0 - 39 * DAY),
  creator: { handle: "caracreates", primaryPlatform: "instagram", followerCount: 12400, totalAudience: 15800, audienceStack: { instagram: 12400, tiktok: 3400 }, audienceMarkets: [{ market: "Nashville", pct: 74 }], categories: ["Food & Drink"], localAudiencePct: 74, tierBand: "Locals", profileComplete: true, hasPhoto: true, bio: "Nashville eats, weekly.", paidRate: 150, licensingFee: 150, momentumPoints: 340 } });
put("photo:cara", { contentType: "image/png", dataBase64: PX });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@landing.dev"
env["ADMIN_PASSWORD"] = "qa-admin-pass-landing"
# Production behavior: NO Google env at all.
for k in ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
          "GOOGLE_REDIRECT_URI", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER",
          "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"]:
    env.pop(k, None)
_srv_log = open(os.path.join(OUT, "server.log"), "w")
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=_srv_log, stderr=_srv_log)
R = {}
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)
    boot = json.load(urllib.request.urlopen(BASE + "/api/bootstrap", timeout=5))
    R["bootstrap_google_configured"] = (boot.get("googleSignin") or {}).get("configured")
    R["bootstrap_build"] = boot.get("build") or boot.get("buildId")

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        # ---- 1. Signed-out at 390px ----
        ctx = b.new_context(viewport={"width": 390, "height": 844}, ignore_https_errors=True,
                            has_touch=True, is_mobile=True, device_scale_factor=3)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:140]))
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_timeout(2200)
        R["signedout"] = page.evaluate("""() => {
          const els = [...document.querySelectorAll('a, button')];
          const si = els.find((e) => e.innerText && e.innerText.trim() === 'Sign in');
          const out = { signInFound: !!si };
          if (si) { const cs = getComputedStyle(si); out.signInColor = cs.color; out.signInWeight = cs.fontWeight; }
          out.googleButtonPresent = document.body.innerText.includes('Continue with Google');
          out.signInLinkFormPresent = document.body.innerText.includes('Email me a sign-in link');
          out.overflow = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth;
          return out;
        }""")
        page.screenshot(path=os.path.join(OUT, "signedout-390.png"), full_page=True)
        R["signedout_pageerrors"] = errs
        ctx.close()

        # ---- 2. Creator shell + Everything panel ----
        ctx = b.new_context(viewport={"width": 390, "height": 844}, ignore_https_errors=True,
                            has_touch=True, is_mobile=True, device_scale_factor=3)
        r = ctx.request.post(BASE + "/api/auth/login", data={"email": "cara@landingqa.dev", "password": PW})
        R["login_status"] = r.status
        page = ctx.new_page()
        errs2 = []
        page.on("pageerror", lambda e: errs2.append(str(e)[:140]))
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_timeout(3000)
        R["creator"] = page.evaluate("""() => {
          const out = {};
          out.barLabels = [...document.querySelectorAll('#tabbar .tab-item')]
            .filter((e) => getComputedStyle(e).display !== 'none')
            .map((e) => { const l = e.querySelector('.tab-label'); return (l ? l.innerText : e.innerText).trim(); });
          const av = document.querySelector('.id-avatar img, [class*=avatar] img');
          out.identityHasPhotoImg = !!av;
          out.sigArtSrc = (() => { const s = document.querySelector('img[src*="sig-"]'); return s ? s.getAttribute('src') : null; })();
          out.overflow = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth;
          return out;
        }""")
        page.screenshot(path=os.path.join(OUT, "creator-home-390.png"), full_page=True)
        # Open the Everything panel (top-right button).
        opened = page.evaluate("""() => {
          const btns = [...document.querySelectorAll('button, a')];
          const btn = btns.find((e) => e.innerText && e.innerText.trim() === 'Everything');
          if (!btn) return 'button-not-found';
          btn.click(); return 'clicked';
        }""")
        page.wait_for_timeout(800)
        R["everything_click"] = opened
        R["everything_panel"] = page.evaluate("""() => {
          const pn = document.querySelector('#everything-panel125');
          if (!pn) return null;
          return { title: pn.querySelector('.ev125-head strong') ? pn.querySelector('.ev125-head strong').innerText.trim() : '',
                   groups: [...pn.querySelectorAll('.ev125-group')].map((g) => g.querySelector('h5') ? g.querySelector('h5').innerText.trim() : '') };
        }""")
        page.screenshot(path=os.path.join(OUT, "creator-everything-390.png"), full_page=True)
        R["creator_pageerrors"] = errs2
        ctx.close()
        b.close()
finally:
    server.terminate()

json.dump(R, open(os.path.join(OUT, "results.json"), "w"), indent=2)
print(json.dumps(R, indent=2))
