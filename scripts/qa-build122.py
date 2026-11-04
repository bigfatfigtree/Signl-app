#!/usr/bin/env python3
"""Build -122 Playwright QA (header + sign-in quick fixes):
- Signed-out header at 390 + 1440: the "Sign in" link's computed
  color (must be solid Ink rgb(23,21,18), not the old sage) and
  the sign-in screen itself.
- Admin home at 390 + 1440: identity row pinned LEFT, and the
  content gutters symmetric (first card's left inset == right
  inset; section bar's first chip aligned with the cards).
- Creator WITH an uploaded photo (cara): the identity circle is
  the photo (img loaded) in the top bar on the phone and in the
  rail user card on desktop.
- Creator WITHOUT a photo (fiona): the initial circle, no img.
- Creator whose photo record is missing (ghost: hasPhoto true,
  no photo row): the img self-removes, the initial shows, and
  the layout is intact — the fallback proof.
- Business with an asset-packet logo (basil): an identity img
  renders from the packet logo URL.
Chromium runs through the local relay (127.0.0.1:8899) with
loopback bypassed, per the standing QA chain. Seed mirrors
qa-build121.py (direct-DB, scrypt hashes)."""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build122-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9068
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b122-qa-")
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
putUser({ id: "cara", role: "creator", email: "cara@b122qa.dev", name: "Cara Creators", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 40 * DAY), updatedAt: iso(now0 - 2 * DAY), reviewedAt: iso(now0 - 39 * DAY),
  creator: { handle: "caracreates", primaryPlatform: "instagram", followerCount: 12400, totalAudience: 15800, audienceStack: { instagram: 12400, tiktok: 3400 }, audienceMarkets: [{ market: "Nashville", pct: 74 }], categories: ["Food & Drink"], localAudiencePct: 74, tierBand: "Locals", profileComplete: true, hasPhoto: true, bio: "Nashville eats, weekly.", paidRate: 150, momentumPoints: 340 } });
put("photo:cara", { contentType: "image/png", dataBase64: PX });
putUser({ id: "fiona", role: "creator", email: "fiona@b122qa.dev", name: "Fiona Founding", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 6 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 5 * DAY),
  creator: { handle: "fionafounding", primaryPlatform: "instagram", followerCount: 3100, totalAudience: 3100, audienceStack: { instagram: 3100 }, categories: ["Coffee & Bakery"], localAudiencePct: 71, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "Richmond coffee runs." } });
putUser({ id: "ghost", role: "creator", email: "ghost@b122qa.dev", name: "Ghost Missing", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 9 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 8 * DAY),
  creator: { handle: "ghostgone", primaryPlatform: "instagram", followerCount: 5200, totalAudience: 5200, audienceStack: { instagram: 5200 }, categories: ["Food & Drink"], localAudiencePct: 63, tierBand: "Locals", profileComplete: true, hasPhoto: true, bio: "Photo record deliberately absent." } });
putUser({ id: "penny", role: "creator", email: "penny@b122qa.dev", name: "Penny Pending", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 1 * DAY), updatedAt: iso(now0 - 1 * DAY),
  creator: { handle: "pennyposts", primaryPlatform: "instagram", followerCount: 8200, totalAudience: 8200, audienceStack: { instagram: 8200 }, categories: ["Coffee & Bakery"], localAudiencePct: 66, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "" } });
putUser({ id: "basil", role: "business", email: "basil@b122qa.dev", name: "Basil Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 29 * DAY),
  business: { businessName: "Basil & Co", category: "Restaurant", plan: "growth", planId: "growth", planName: "Growth $349/mo", accessState: "active", about: "Wood-fired kitchen in East Nashville.", address: "1000 Woodland St",
    assetPacket: { logoUrl: "http://127.0.0.1:__PORT__/api/users/cara/photo", links: [], talkingPoints: "", handle: "", hashtags: [] } } });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
""".replace("__PORT__", str(PORT))
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-" + "pass-122"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b122.dev"
env["ADMIN_PASSWORD"] = ADMIN_PW
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)[:120]))
            st = login(ctx, email, pw)
            page.goto(BASE + "/", wait_until="networkidle")
            page.wait_for_timeout(2600)
            return ctx, page, st, errs

        def shot(page, name, full=True):
            page.screenshot(path=os.path.join(OUT, name), full_page=full)

        # ============ SIGNED OUT: sign-in link black ============
        ctx0 = b.new_context(viewport={"width": 390, "height": 844}, ignore_https_errors=True)
        pg0 = ctx0.new_page()
        pg0.goto(BASE + "/", wait_until="networkidle")
        pg0.wait_for_timeout(1500)
        R["signin_link"] = pg0.evaluate("""() => {
          const a = document.querySelector('#topnav a.nav-signin');
          if (!a) return null;
          const cs = getComputedStyle(a);
          const r = a.getBoundingClientRect();
          return { color: cs.color, weight: cs.fontWeight, x: Math.round(r.x), visible: r.width > 0 };
        }""")
        shot(pg0, "signedout-header-390.png", full=False)
        if pg0.locator("#topnav a.nav-signin").count():
            pg0.locator("#topnav a.nav-signin").first.click()
            pg0.wait_for_timeout(1200)
        shot(pg0, "signin-screen-390.png", full=False)
        ctx0.close()

        ctx0d = b.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
        pg0d = ctx0d.new_page()
        pg0d.goto(BASE + "/", wait_until="networkidle")
        pg0d.wait_for_timeout(1500)
        R["signin_link_desktop"] = pg0d.evaluate("""() => {
          const a = document.querySelector('#topnav a.nav-signin');
          if (!a) return null;
          const cs = getComputedStyle(a);
          return { color: cs.color, weight: cs.fontWeight };
        }""")
        shot(pg0d, "signedout-header-desktop.png", full=False)
        ctx0d.close()

        # ============ ADMIN: identity left + symmetric gutters ============
        def admin_sym(page):
            return page.evaluate("""() => {
              const vw = window.innerWidth;
              const ava = document.querySelector('#toprow .ava122w, #toprow .tr-ava');
              const name = document.querySelector('#toprow .tr-name');
              const help = document.querySelector('#toprow .tr-right a');
              const card = document.querySelector('main .nx-card, main .panel, main .admin-deck-card, main .sig-card');
              const chip = document.querySelector('#admin-secbar .sec-chip121');
              const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), right: Math.round(vw - r.right), w: Math.round(r.width) }; };
              return { vw, ava: box(ava), name: box(name), help: box(help), card: box(card), chip: box(chip),
                       avaIsImg: !!document.querySelector('#toprow img.ava122i') };
            }""")

        actx, apage, ast, aerrs = open_role("admin@b122.dev", 390, 844, ADMIN_PW)
        R["admin_login"] = ast
        R["admin_page_errors"] = aerrs
        try:
            apage.locator("#admin-summary .sum-chip121").first.wait_for(timeout=6000)
        except Exception:
            pass
        R["admin_sym_390"] = admin_sym(apage)
        shot(apage, "admin-home-390.png")
        actx.close()

        actx2, apage2, ast2, _ = open_role("admin@b122.dev", 1440, 900, ADMIN_PW)
        try:
            apage2.locator("#admin-summary .sum-chip121").first.wait_for(timeout=6000)
        except Exception:
            pass
        R["admin_sym_1440"] = admin_sym(apage2)
        shot(apage2, "admin-home-desktop.png")
        actx2.close()

        # ============ CREATOR WITH PHOTO (cara) ============
        def tb2_ava(page):
            return page.evaluate("""() => {
              const img = document.querySelector('.tb2-id img.ava122i');
              const span = document.querySelector('.tb2-id .tb2-ava.txt, .tb2-id span.tb2-ava');
              const host = document.querySelector('.tb2-id');
              const r = host ? host.getBoundingClientRect() : null;
              return { img: !!img, imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
                       initialText: span ? span.textContent.trim() : null,
                       idX: r ? Math.round(r.x) : null };
            }""")

        cctx, cpage, cst, cerrs = open_role("cara@b122qa.dev", 390, 844)
        R["cara_login"] = cst
        R["cara_page_errors"] = cerrs
        R["cara_tb2_390"] = tb2_ava(cpage)
        shot(cpage, "creator-photo-390.png")
        cctx.close()

        cctx2, cpage2, _, _ = open_role("cara@b122qa.dev", 1440, 900)
        R["cara_railfoot_desktop"] = cpage2.evaluate("""() => {
          const img = document.querySelector('.tab-user img.ava122i');
          const w = document.querySelector('.tab-user .ava122w');
          return { img: !!img, imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false, wrapped: !!w };
        }""")
        shot(cpage2, "creator-photo-desktop.png")
        cctx2.close()

        # ============ CREATOR WITHOUT PHOTO (fiona) ============
        fctx, fpage, fst, _ = open_role("fiona@b122qa.dev", 390, 844)
        R["fiona_login"] = fst
        R["fiona_tb2_390"] = tb2_ava(fpage)
        shot(fpage, "creator-initial-390.png")
        fctx.close()

        # ============ FALLBACK: photo record missing (ghost) ============
        gctx, gpage, gst, _ = open_role("ghost@b122qa.dev", 390, 844)
        gpage.wait_for_timeout(1200)
        R["ghost_login"] = gst
        R["ghost_tb2_390"] = tb2_ava(gpage)
        shot(gpage, "creator-fallback-390.png")
        gctx.close()

        # ============ BUSINESS WITH PACKET LOGO (basil) ============
        bctx, bpage, bst, _ = open_role("basil@b122qa.dev", 390, 844)
        R["basil_login"] = bst
        R["basil_identity_390"] = bpage.evaluate("""() => {
          const img = document.querySelector('.tb2-id img.ava122i, #toprow img.ava122i, .tab-user img.ava122i');
          const any = document.querySelector('.tb2-id, #toprow .tr-in, .tab-user');
          return { img: !!img, imgLoaded: img ? (img.complete && img.naturalWidth > 0) : false,
                   host: any ? any.className || any.id : null };
        }""")
        shot(bpage, "business-logo-390.png")
        bctx.close()

        b.close()
finally:
    server.kill()

json.dump(R, open(os.path.join(OUT, "results.json"), "w"), indent=1)
print(json.dumps(R, indent=1))
