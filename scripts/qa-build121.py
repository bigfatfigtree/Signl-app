#!/usr/bin/env python3
"""Build -121 Playwright QA (full width, density, admin section bar):
- Admin home at desktop (1440) + phone (390): the summary chip
  strip, the two-column Sig + queue grid on desktop, the mobile
  section bar with EVERY admin section as a chip, and a click
  through every chip proving it lands on its section.
- Width measurements per role home (main + .wrap clientWidth vs
  viewport) and document scroll heights, for the density record.
- Creator phone home: the three shapes cells in one row.
- Admin review deck + one widened screen per other role.
Chromium runs through the local relay (127.0.0.1:8899) with
loopback bypassed, per the standing QA chain. Seed mirrors
qa-build119.py (direct-DB, scrypt hashes)."""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build121-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9067
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b121-qa-")
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
putUser({ id: "cara", role: "creator", email: "cara@b119qa.dev", name: "Cara Creators", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 40 * DAY), updatedAt: iso(now0 - 2 * DAY), reviewedAt: iso(now0 - 39 * DAY),
  creator: { handle: "caracreates", primaryPlatform: "instagram", followerCount: 12400, totalAudience: 15800, audienceStack: { instagram: 12400, tiktok: 3400 }, audienceMarkets: [{ market: "Nashville", pct: 74 }], categories: ["Food & Drink"], localAudiencePct: 74, tierBand: "Locals", profileComplete: true, hasPhoto: true, bio: "Nashville eats, weekly.", paidRate: 150, momentumPoints: 340 } });
put("photo:cara", { contentType: "image/png", dataBase64: PX });
putUser({ id: "fiona", role: "creator", email: "fiona@b119qa.dev", name: "Fiona Founding", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 6 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 5 * DAY),
  creator: { handle: "fionafounding", primaryPlatform: "instagram", followerCount: 3100, totalAudience: 3100, audienceStack: { instagram: 3100 }, categories: ["Coffee & Bakery"], localAudiencePct: 71, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "Richmond coffee runs." } });
putUser({ id: "penny", role: "creator", email: "penny@b119qa.dev", name: "Penny Pending", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 1 * DAY), updatedAt: iso(now0 - 1 * DAY),
  creator: { handle: "pennyposts", primaryPlatform: "instagram", followerCount: 8200, totalAudience: 8200, audienceStack: { instagram: 8200 }, categories: ["Coffee & Bakery"], localAudiencePct: 66, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "" } });
putUser({ id: "basil", role: "business", email: "basil@b119qa.dev", name: "Basil Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 29 * DAY),
  business: { businessName: "Basil & Co", category: "Restaurant", plan: "growth", planId: "growth", planName: "Growth $349/mo", accessState: "active", about: "Wood-fired kitchen in East Nashville.", address: "1000 Woodland St" } });
putUser({ id: "faye", role: "business", email: "faye@b119qa.dev", name: "Faye Founder", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 5 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 4 * DAY),
  business: { businessName: "Faye's Bakery", category: "Bakery", plan: "self-service", planId: "self-service", accessState: "founding", about: "" } });
putUser({ id: "patp", role: "partner", email: "pat@b119qa.dev", name: "Pat Partner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: iso(now0 - 60 * DAY), updatedAt: iso(now0 - 3 * DAY), reviewedAt: iso(now0 - 59 * DAY), termsVersion: "2026-10-19", termsAcceptedAt: iso(now0 - 59 * DAY), creator: null, business: null,
  partner: { name: "Pat Media Group", code: "patmedia", type: "media", contactName: "Pat Partner", markets: ["Nashville"], sharePct: 35, status: "active", agreementStatus: "signed", agreementSignedAt: iso(now0 - 59 * DAY), demo: false } });
put("pilot:pilot-119", { id: "pilot-119", name: "Nashville First Visits Pilot", partnerName: "City Fund", marketId: "nashville", marketName: "Nashville", fundCents: 500000, status: "active", partnerUserId: "fayefund", createdAt: iso(now0 - 20 * DAY), updatedAt: iso(now0 - 2 * DAY) });
putUser({ id: "fayefund", role: "pilot_partner", email: "fund@b119qa.dev", name: "Faye Fund", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", pilotId: "pilot-119", createdAt: iso(now0 - 20 * DAY), updatedAt: iso(now0 - 2 * DAY), creator: null, business: null });
put("pilotbiz:pilot-119:pb1", { id: "pb1", pilotId: "pilot-119", businessId: "basil", name: "Basil & Co", marketName: "Nashville", status: "selected", createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 2 * DAY) });
put("pilotbiz:pilot-119:pb2", { id: "pb2", pilotId: "pilot-119", businessId: null, name: "Off-books Taqueria", marketName: "Nashville", status: "invited", createdAt: iso(now0 - 9 * DAY), updatedAt: iso(now0 - 2 * DAY) });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-" + "pass-121"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b119.dev"
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

        def overflow(page):
            return page.evaluate("Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth")

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

        def shot(page, name):
            page.screenshot(path=os.path.join(OUT, name), full_page=True)

        def measure(page):
            return page.evaluate("""() => {
              const main = document.querySelector('main');
              const wrap = document.querySelector('main .wrap');
              const r = (el) => el ? Math.round(el.getBoundingClientRect().width) : null;
              return { vw: window.innerWidth, mainW: r(main), wrapW: r(wrap),
                       docH: document.documentElement.scrollHeight };
            }""")

        # ============ ADMIN DESKTOP (1440) ============
        actx, apage, ast, aerrs = open_role("admin@b119.dev", 1440, 900, ADMIN_PW)
        R["admin_login"] = ast
        R["admin_page_errors"] = aerrs
        # wait for the Sig summary to settle (counts load async)
        try:
            apage.locator("#admin-summary .sum-chip121").first.wait_for(timeout=6000)
        except Exception:
            pass
        apage.wait_for_timeout(800)
        R["measure_admin_desktop"] = measure(apage)
        R["admin_summary_chips"] = apage.locator("#admin-summary .sum-chip121").all_inner_texts() if apage.locator("#admin-summary").count() else []
        R["admin_rail_labels"] = [t.strip() for t in apage.locator("#rail .rail-item .rail-label-full, #rail .rail-item .rail-label").all_inner_texts()]
        grid = apage.evaluate("""() => {
          const sig = document.querySelector('#admin-sig');
          const tb = document.querySelector('#tab-body');
          if (!sig || !tb) return null;
          const a = sig.getBoundingClientRect(), c = tb.getBoundingClientRect();
          return { sigX: Math.round(a.x), sigY: Math.round(a.y), tbX: Math.round(c.x), tbY: Math.round(c.y),
                   sideBySide: Math.abs(a.y - c.y) < 240 && a.x !== c.x };
        }""")
        R["admin_home_grid"] = grid
        R["admin_secbar_desktop_visible"] = apage.locator("#admin-secbar").is_visible() if apage.locator("#admin-secbar").count() else False
        shot(apage, "admin-home-desktop.png")
        R["admin_desktop_overflow"] = overflow(apage)
        # review deck shot: the landing IS the deck; capture the deck card area
        R["admin_deck_cards"] = apage.locator(".admin-deck-card").count()
        try:
            apage.locator(".admin-deck-card").first.scroll_into_view_if_needed(timeout=3000)
            apage.wait_for_timeout(500)
            apage.screenshot(path=os.path.join(OUT, "admin-review-deck-desktop.png"))
        except Exception as e:
            R["admin_deck_shot"] = f"ERR {e}"
        # Markets: widened grid screen
        try:
            apage.locator("#rail .rail-item:has-text('Markets')").first.click(timeout=4000)
            apage.wait_for_timeout(1800)
            R["measure_admin_markets"] = measure(apage)
            R["admin_markets_cards"] = apage.locator(".mkt-card").count()
            shot(apage, "admin-markets-desktop.png")
        except Exception as e:
            R["admin_markets"] = f"ERR {e}"
        actx.close()

        # ============ ADMIN PHONE (390) ============
        amctx, ampage, _, amerrs = open_role("admin@b119.dev", 390, 844, ADMIN_PW)
        R["admin_phone_errors"] = amerrs
        try:
            ampage.locator("#admin-secbar .sec-chip121").first.wait_for(timeout=6000)
        except Exception:
            pass
        ampage.wait_for_timeout(600)
        R["measure_admin_390"] = measure(ampage)
        R["admin_secbar_visible"] = ampage.locator("#admin-secbar").is_visible() if ampage.locator("#admin-secbar").count() else False
        chips = ampage.locator("#admin-secbar .sec-chip121")
        R["admin_secbar_chips"] = [t.strip() for t in chips.all_inner_texts()]
        sumbox = ampage.evaluate("""() => {
          const s = document.querySelector('#admin-summary');
          if (!s) return null;
          const r = s.getBoundingClientRect();
          return { y: Math.round(r.y + window.scrollY), h: Math.round(r.height), inFirstScreen: (r.y + window.scrollY) < 700 };
        }""")
        R["admin_summary_pos_390"] = sumbox
        shot(ampage, "admin-home-390.png")
        # click EVERY chip and prove it lands: the chip lights up
        # and the tab body content changes / carries its marker.
        landings = {}
        labels = R["admin_secbar_chips"]
        for i, label in enumerate(labels):
            try:
                ampage.locator("#admin-secbar .sec-chip121").nth(i).click(timeout=3000)
                ampage.wait_for_timeout(1100)
                state = ampage.evaluate("""() => {
                  const on = document.querySelector('#admin-secbar .sec-chip121.on');
                  const tb = document.querySelector('#tab-body');
                  return { onChip: on ? on.innerText.trim() : null,
                           bodyStart: tb ? tb.innerText.replace(/\\s+/g, ' ').slice(0, 90) : null };
                }""")
                landings[label] = state
            except Exception as e:
                landings[label] = f"ERR {str(e)[:100]}"
        R["admin_secbar_landings"] = landings
        # back to Applications for the deck shot on phone
        try:
            ampage.locator("#admin-secbar .sec-chip121").first.click(timeout=3000)
            ampage.wait_for_timeout(1200)
        except Exception:
            pass
        shot(ampage, "admin-review-390.png")
        R["admin_390_overflow"] = overflow(ampage)
        amctx.close()

        # ============ CREATOR ============
        cctx, cpage, cst, _ = open_role("cara@b119qa.dev", 1440, 900)
        R["creator_login"] = cst
        R["measure_creator_desktop"] = measure(cpage)
        shot(cpage, "creator-home-desktop.png")
        R["creator_desktop_overflow"] = overflow(cpage)
        cctx.close()

        cmctx, cmpage, _, _ = open_role("cara@b119qa.dev", 390, 844)
        R["measure_creator_390"] = measure(cmpage)
        R["creator_shapes_ys"] = cmpage.evaluate("""() => [...document.querySelectorAll('.shapes-row .shape-cell')].map((el) => Math.round(el.getBoundingClientRect().y + window.scrollY))""")
        shot(cmpage, "creator-home-390.png")
        R["creator_390_overflow"] = overflow(cmpage)
        cmctx.close()

        # ============ BUSINESS ============
        bctx, bpage, bst, _ = open_role("basil@b119qa.dev", 1440, 900)
        R["business_login"] = bst
        R["measure_business_desktop"] = measure(bpage)
        shot(bpage, "business-home-desktop.png")
        R["business_desktop_overflow"] = overflow(bpage)
        bctx.close()

        # ============ PARTNER ============
        pctx, ppage, pst, _ = open_role("pat@b119qa.dev", 1440, 900)
        R["partner_login"] = pst
        R["measure_partner_desktop"] = measure(ppage)
        shot(ppage, "partner-home-desktop.png")
        R["partner_desktop_overflow"] = overflow(ppage)
        pctx.close()

        # ============ PILOT ============
        ictx, ipage, ist, _ = open_role("fund@b119qa.dev", 1440, 900)
        R["pilot_login"] = ist
        R["measure_pilot_desktop"] = measure(ipage)
        shot(ipage, "pilot-overview-desktop.png")
        R["pilot_desktop_overflow"] = overflow(ipage)
        ictx.close()
finally:
    server.kill()

print(json.dumps(R, indent=1))
