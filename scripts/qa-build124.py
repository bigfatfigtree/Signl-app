#!/usr/bin/env python3
"""Build -124 Playwright QA (Sig character swap to Concept A):
- Creator home at phone (390) + desktop (1440): the Sig FAB pill,
  the bottom-tab / rail Sig icon, and the queue card avatar all
  show the orb still; the Sig tab hero plays the animated orb (Build -130).
- Admin home desktop: the Admin Sig card avatar.
- Business home desktop: the Ask Sig row avatar.
- Network audit on every page: every /assets/sig-* request is a
  sig-orb assets answered 200; ZERO requests for retired sig-a/sig-v4 art.
  any Sig clip (stills-only gate holds in the real render).
Chromium runs through the local relay (127.0.0.1:8899) with
loopback bypassed, per the standing QA chain. Seed mirrors
qa-build121.py (direct-DB, scrypt hashes)."""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build124-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9068
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b124-qa-")
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
putUser({ id: "cara", role: "creator", email: "cara@b124qa.dev", name: "Cara Creators", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 40 * DAY), updatedAt: iso(now0 - 2 * DAY), reviewedAt: iso(now0 - 39 * DAY),
  creator: { handle: "caracreates", primaryPlatform: "instagram", followerCount: 12400, totalAudience: 15800, audienceStack: { instagram: 12400, tiktok: 3400 }, audienceMarkets: [{ market: "Nashville", pct: 74 }], categories: ["Food & Drink"], localAudiencePct: 74, tierBand: "Locals", profileComplete: true, hasPhoto: true, bio: "Nashville eats, weekly.", paidRate: 150, momentumPoints: 340 } });
put("photo:cara", { contentType: "image/png", dataBase64: PX });
putUser({ id: "basil", role: "business", email: "basil@b124qa.dev", name: "Basil Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 29 * DAY),
  business: { businessName: "Basil & Co", category: "Restaurant", plan: "growth", planId: "growth", planName: "Growth $349/mo", accessState: "active", about: "Wood-fired kitchen in East Nashville.", address: "1000 Woodland St" } });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-" + "pass-124"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b124.dev"
env["ADMIN_PASSWORD"] = ADMIN_PW
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=open(os.path.join(tmp, "server.log"), "w"), stderr=subprocess.STDOUT)
R = {}
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def login(ctx, email, pw=PW):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
            return r.status

        def open_role(email, width, height, pw=PW):
            ctx = b.new_context(viewport={"width": width, "height": height}, ignore_https_errors=True)
            page = ctx.new_page()
            page.on("dialog", lambda d: d.accept())
            errs, sigreq = [], []
            page.on("pageerror", lambda e: errs.append(str(e)[:120]))
            page.on("response", lambda r: sigreq.append((r.url.split("127.0.0.1:9068")[-1], r.status)) if "/assets/sig" in r.url else None)
            st = login(ctx, email, pw)
            page.goto(BASE + "/", wait_until="networkidle")
            page.wait_for_timeout(2600)
            return ctx, page, st, errs, sigreq

        def shot(page, name):
            page.screenshot(path=os.path.join(OUT, name), full_page=True)

        def sig_audit(sigreq):
            return {
                "sig_orb_200": sorted({u for u, s in sigreq if u.startswith("/assets/sig-orb/") and s == 200}),
                "sig_bad": [(u, s) for u, s in sigreq if s >= 400],
                "sig_v4_requests": [u for u, s in sigreq if "sig-v4" in u],
                "clip_requests": [u for u, s in sigreq if u.endswith((".webm", ".mp4"))],
            }

        # ============ CREATOR PHONE (390) ============
        cctx, cpage, cst, cerrs, csig = open_role("cara@b124qa.dev", 390, 844)
        R["creator_login"] = cst
        R["creator_page_errors"] = cerrs
        R["creator_fab_visible"] = cpage.locator(".sig-fab").first.is_visible() if cpage.locator(".sig-fab").count() else False
        R["creator_avatars"] = cpage.locator("img[src*='/assets/sig-orb/']").count()
        shot(cpage, "creator-home-390.png")
        # Sig tab: the hero still in the large placement (the app's
        # own navigation, the same call the More-row tap makes)
        try:
            cpage.evaluate("go('dashboard','Sig')")
            cpage.wait_for_timeout(1800)
            R["sig_tab_nav"] = "go('dashboard','Sig') ok"
        except Exception as e:
            R["sig_tab_click"] = f"ERR {e}"
        R["creator_hero_src"] = cpage.locator(".sig-hero-still").first.get_attribute("src") if cpage.locator(".sig-hero-still").count() else None
        R["creator_hero_video_hidden"] = cpage.locator("[data-sig-hero-video]").first.evaluate("v => v.hidden") if cpage.locator("[data-sig-hero-video]").count() else None
        shot(cpage, "creator-sig-tab-390.png")
        R["creator_sig_network"] = sig_audit(csig)
        cctx.close()

        # ============ CREATOR DESKTOP (1440) ============
        dctx, dpage, dst, derrs, dsig = open_role("cara@b124qa.dev", 1440, 900)
        R["creator_desktop_avatars"] = dpage.locator("img[src*='/assets/sig-orb/']").count()
        shot(dpage, "creator-home-desktop.png")
        R["creator_desktop_sig_network"] = sig_audit(dsig)
        dctx.close()

        # ============ ADMIN DESKTOP ============
        actx, apage, ast, aerrs, asig = open_role("admin@b124.dev", 1440, 900, ADMIN_PW)
        R["admin_login"] = ast
        R["admin_page_errors"] = aerrs
        try:
            apage.locator("#admin-sig .sig-ava-img img").first.wait_for(timeout=6000)
        except Exception:
            pass
        apage.wait_for_timeout(800)
        R["admin_sig_avatars"] = apage.locator("img[src*='/assets/sig-orb/']").count()
        shot(apage, "admin-home-desktop.png")
        R["admin_sig_network"] = sig_audit(asig)
        actx.close()

        # ============ BUSINESS DESKTOP ============
        bctx, bpage, bst, berrs, bsig = open_role("basil@b124qa.dev", 1440, 900)
        R["business_login"] = bst
        R["business_page_errors"] = berrs
        R["business_sig_avatars"] = bpage.locator("img[src*='/assets/sig-orb/']").count()
        shot(bpage, "business-home-desktop.png")
        R["business_sig_network"] = sig_audit(bsig)
        bctx.close()

        b.close()
finally:
    server.kill()

print(open(os.path.join(tmp, "server.log")).read()[-1500:]) if os.path.exists(os.path.join(tmp, "server.log")) else None
print(json.dumps(R, indent=1))
open(os.path.join(OUT, "qa-results.json"), "w").write(json.dumps(R, indent=1))
