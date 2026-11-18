#!/usr/bin/env python3
"""Build -136 QA: Jeff's card rulings (2026-11-06).

  before — proves the -135 state: no accepts-comps switch on any
           card, the local follower count rides inside the % caption
           (not highlighted under the block), and the "Would accept
           as a comped visit" filter returns a paid-only creator who
           still has comp categories stored (second source of truth).
  after  — asserts the fix: highlighted ON switch ("Accepts comps")
           vs muted OFF switch ("Paid only") at the price line on
           tile + PDP buy box, the count as a highlighted chip under
           the % block (tile + tray), the comp filter gated on
           compOpen, and the setup lane switch in Jeff's plain words
           driving the live preview.

Usage: qa-build136.py [before|after]
Screenshots land in ~/workspace/research_notes/signl-build136-qa/.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request

PHASE = sys.argv[1] if len(sys.argv) > 1 else "after"
assert PHASE in ("before", "after")
BEFORE = PHASE == "before"

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build136-qa")
PORT = 9090
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)
SFX = "-before" if BEFORE else "-after"

PW = "qa-pass-136"
SALT = "qa136salt"
HASH = subprocess.run(["node", "-e",
    "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
    PW, SALT], capture_output=True, text=True, check=True).stdout.strip()
NOW = int(time.time() * 1000)
DAY = 86400000

def u(uid, **kw):
    d = {"id": uid, "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
         "createdAt": "2026-09-01T00:00:00.000Z", "tester": False}
    d.update(kw); return d

data = {}
data["user:bizqa"] = u("bizqa", role="business", email="biz@qa136.dev", name="QA Cuts Owner",
    market="Hampton Roads", business={"businessName": "QA Cuts", "legalName": "QA Cuts LLC",
    "category": "Beauty & Grooming", "address": "100 Ghent Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550100", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["user:trackbiz"] = u("trackbiz", role="business", email="track@qa136.dev", name="Track Owner",
    market="Hampton Roads", business={"businessName": "Track Record Tacos", "legalName": "TRT LLC",
    "category": "Restaurant", "address": "200 Colley Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550101", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
# Maya: paid rate AND accepts comps -> rate line + ON switch.
data["user:mayabakes"] = u("mayabakes", role="creator", email="maya@qa136.dev", name="Maya Rivers", city="Norfolk", market="Hampton Roads",
    creator={"name": "Maya Rivers", "handle": "mayabakes", "platform": "Instagram",
    "handleNormalized": "mayabakes", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ghent", "zip": "23510", "categories": ["Food & Drink"], "tierBand": "Locals",
    "compCategories": ["Restaurant meals"],
    "totalAudience": 10000, "audienceStack": {"instagram": 10000}, "platformFollowers": {"instagram": 10000},
    "localAudiencePct": 86, "paidRate": 150, "compOpen": True, "profileComplete": True,
    "publicPage": True, "bio": "Norfolk baker. Sourdough, cakes, and the farmers market.",
    "avgViews": 4200, "topAudienceCities": ["Norfolk", "Virginia Beach"],
    "audienceMarkets": [{"market": "Hampton Roads", "pct": 86}],
    "bestWork": ["https://www.instagram.com/reel/Cabc123XYZ/"]})
# Noah: comp-only (no rate) -> "Comped visit" line + ON switch.
data["user:noahnew"] = u("noahnew", role="creator", email="noah@qa136.dev", name="Noah New", city="Norfolk", market="Hampton Roads",
    creator={"name": "Noah New", "handle": "noahnew", "platform": "TikTok",
    "handleNormalized": "noahnew", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ocean View", "zip": "23503", "categories": ["Fitness"], "tierBand": "Neighbors",
    "compCategories": ["Fitness classes & passes"],
    "totalAudience": 3000, "audienceStack": {"tiktok": 3000}, "platformFollowers": {"tiktok": 3000},
    "localAudiencePct": 64, "compOpen": True, "profileComplete": True, "publicPage": True,
    "bio": "Beach workouts and sunrise runs.", "audienceMarkets": [{"market": "Hampton Roads", "pct": 64}]})
# Paige: PAID ONLY (compOpen False) but still carries a stored comp
# category — the second-source-of-truth trap for the comp filter.
data["user:paigepaid"] = u("paigepaid", role="creator", email="paige@qa136.dev", name="Paige Paidonly", city="Norfolk", market="Hampton Roads",
    creator={"name": "Paige Paidonly", "handle": "paigepaid", "platform": "Instagram",
    "handleNormalized": "paigepaid", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ghent", "zip": "23517", "categories": ["Beauty & Grooming"], "tierBand": "Neighbors",
    "compCategories": ["Restaurant meals"],
    "totalAudience": 5000, "audienceStack": {"instagram": 5000}, "platformFollowers": {"instagram": 5000},
    "localAudiencePct": 78, "paidRate": 200, "compOpen": False, "profileComplete": True,
    "publicPage": True, "bio": "Norfolk beauty creator. Paid bookings only.",
    "audienceMarkets": [{"market": "Hampton Roads", "pct": 78}]})
# Casey: the creator whose setup + live preview we drive.
data["user:casey"] = u("casey", role="creator", email="casey@qa136.dev", name="Casey Creates", city="Norfolk", market="Hampton Roads",
    creator={"name": "Casey Creates", "handle": "caseycreates", "platform": "Instagram",
    "handleNormalized": "caseycreates", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ghent", "zip": "23517", "categories": [], "tierBand": "Neighbors",
    "totalAudience": 10000, "audienceStack": {"instagram": 10000}, "platformFollowers": {"instagram": 10000},
    "localAudiencePct": 72, "paidRate": 120, "compOpen": True, "profileComplete": True,
    "publicPage": True, "bio": "Norfolk food and neighborhood stories.",
    "audienceMarkets": [{"market": "Hampton Roads", "pct": 72}]})
data["booking:bk1"] = {"id": "bk1", "creatorId": "mayabakes", "businessId": "trackbiz",
    "creatorName": "Maya Rivers", "createdAt": "2026-10-01T00:00:00.000Z",
    "redeemedAt": "2026-10-02T00:00:00.000Z", "status": "redeemed"}
data["post:po1"] = {"id": "po1", "bookingId": "bk1", "creatorId": "mayabakes", "businessId": "trackbiz",
    "createdAt": "2026-10-02T12:00:00.000Z", "onTime": True, "postUrl": "https://www.instagram.com/p/AAA111/"}

for k in list(data.keys()):
    if k.startswith("user:"):
        data[f"email:{data[k]['email']}"] = {"userId": data[k]["id"]}

# Sandbox quirk (2026-11-06): Python writes to 0600 temp files are
# denied (EPERM), which breaks tempfile's probe. Use a fixed
# workspace dir and pin tempfile.tempdir so library code skips it.
tmp = os.path.join(os.path.expanduser("~"), "workspace", "signl-app", ".qa136-run")
os.makedirs(tmp, exist_ok=True)
tempfile.tempdir = tmp
dbpath = os.path.join(tmp, "db.json")
with open(dbpath, "w") as f: json.dump(data, f)
env = {k: v for k, v in os.environ.items() if not k.startswith(("STRIPE", "SIGNL_STRIPE")) and "TWILIO" not in k and "RESEND" not in k}
env.update({"SIGNL_LOCAL": "1", "SIGNL_MAIL_STUB": "1", "SIGNL_LOCAL_DB": dbpath,
            "SIGNL_TEST_ALLOW_BUSINESS": "1", "APP_URL": BASE})
srv = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=APP, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
    except Exception: time.sleep(0.5)

fails = []
def ck(name, cond, extra=""):
    print(("  ok " if cond else "FAIL ") + name + (f" :: {extra}" if extra and not cond else ""))
    if not cond: fails.append(name)

def login(ctx, email):
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": PW},
                         headers={"Content-Type": "application/json"})
    assert r.ok, f"login {email}: {r.status}"

def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")

def tile(page, name):
    return page.locator(".shelf-tile", has_text=name).first

def tile_text(page, name):
    return page.locator(".shelf-tile", has_text=name).first.inner_text()

CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
               ignore_https_errors=True)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        # ---------- DESKTOP: business Shelf ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(ctx, "biz@qa136.dev")
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_selector(".shelf-tile", timeout=15000)
        page.wait_for_function("document.querySelector('#discover-results').innerText.includes('Paige Paidonly')", timeout=10000)
        maya_t = tile_text(page, "Maya Rivers")
        paige_t = tile_text(page, "Paige Paidonly")
        noah_t = tile_text(page, "Noah New")
        if BEFORE:
            ck("before: no accepts-comps switch exists on any tile", page.query_selector(".shelf-tile .comp-sw") is None)
            ck("before: paid-only and accepts-comps tiles state price identically at the price line",
               "$150" in maya_t and "$200" in paige_t and "Accepts comps" not in maya_t and "Accepts comps" not in paige_t,
               maya_t[:160] + " || " + paige_t[:160])
            ck("before: the local count rides inside the % caption, not as a highlighted chip",
               page.query_selector(".shelf-tile .shelf-localcount") is None
               and "local followers" in (page.locator(".shelf-tile", has_text="Maya Rivers").first.locator(".shelf-local-tx").inner_text()))
            page.screenshot(path=f"{OUT}/01-shelf-desktop{SFX}.png", full_page=True)
            # the filter defect, rendered: Paige (compOpen off, category
            # stored) matches the comp-category filter today.
            page.click(".filters-fold summary")
            page.select_option("#f-comp", "Restaurant meals")
            page.click(".filters .btn.small-btn")
            page.wait_for_function("document.querySelector('#discover-results').innerText.includes('Maya Rivers')", timeout=10000)
            res = page.inner_text("#discover-results")
            ck("before: comp filter returns the PAID-ONLY creator (second source of truth)",
               "Paige Paidonly" in res, res[:200])
        else:
            maya = tile(page, "Maya Rivers")
            ck("after: accepts-comps tile shows the highlighted ON switch at the price line",
               maya.locator(".shelf-price-row .comp-sw.on").count() == 1 and "Accepts comps" in maya_t, maya_t[:240])
            on_style = maya.locator(".comp-sw.on .comp-sw-track").evaluate(
                "e => getComputedStyle(e).backgroundColor")
            ck("after: ON switch track is mint-filled", on_style not in ("rgba(0, 0, 0, 0)", "transparent"), on_style)
            paige = tile(page, "Paige Paidonly")
            ck("after: paid-only tile shows the muted OFF switch, never identical to ON",
               paige.locator(".shelf-price-row .comp-sw").count() == 1 and paige.locator(".comp-sw.on").count() == 0
               and "Paid only" in paige_t, paige_t[:240])
            noah = tile(page, "Noah New")
            ck("after: comp-only tile keeps the Comped visit line AND the ON switch",
               "Comped visit" in noah_t and noah.locator(".comp-sw.on").count() == 1, noah_t[:240])
            chip = maya.locator(".shelf-localcount")
            ck("after: count chip sits directly under the % block with the spelled-out count",
               chip.count() == 1 and "about 8,600 local followers" in chip.inner_text(), chip.inner_text() if chip.count() else "missing")
            chip_style = chip.evaluate("e => { const s = getComputedStyle(e); return s.fontWeight + '|' + s.backgroundColor; }")
            fw, bg = chip_style.split("|")
            ck("after: count chip is highlighted (heavy weight + tinted fill)",
               int(fw) >= 700 and bg not in ("rgba(0, 0, 0, 0)", "transparent"), chip_style)
            pos = page.evaluate("""() => { const t = [...document.querySelectorAll('.shelf-tile')].find(x => x.innerText.includes('Maya Rivers'));
                const pct = t.querySelector('.shelf-pct').getBoundingClientRect();
                const chip = t.querySelector('.shelf-localcount').getBoundingClientRect();
                return chip.top >= pct.bottom - 1; }""")
            ck("after: count chip renders below the % (DOM + geometry)", pos)
            page.screenshot(path=f"{OUT}/01-shelf-desktop{SFX}.png", full_page=True)
            # tray: save Maya + Paige, the count in the tray is highlighted too
            tile(page, "Maya Rivers").locator(".shelf-save").click()
            page.wait_for_function("document.querySelectorAll('.shelf-tile').length >= 3", timeout=8000)
            tile(page, "Paige Paidonly").locator(".shelf-save").click()
            page.wait_for_selector(".shelf-tray", timeout=8000)
            ck("after: tray count is the highlighted chip, not a caption line",
               page.query_selector(".shelf-tray .shelf-tray-count") is not None
               and "8,600" in page.inner_text(".shelf-tray"))
            tray_el = page.query_selector(".shelf-tray")
            tray_el.screenshot(path=f"{OUT}/04-tray-desktop{SFX}.png")
            # PDP: buy box carries the switch for both states
            tile(page, "Maya Rivers").locator(".shelf-name").click()
            page.wait_for_selector(".pdp-hero", timeout=12000)
            ck("after: PDP buy box shows Maya's ON switch",
               page.query_selector("#pdp-buy .comp-sw.on") is not None)
            page.screenshot(path=f"{OUT}/03-pdp-desktop{SFX}.png", full_page=True)
            page.evaluate("go('dashboard','Discover')")
            page.wait_for_selector(".shelf-tile", timeout=12000)
            tile(page, "Paige Paidonly").locator(".shelf-name").click()
            page.wait_for_selector(".pdp-hero", timeout=12000)
            ck("after: PDP buy box shows Paige's OFF switch (Paid only)",
               page.query_selector("#pdp-buy .comp-sw") is not None and page.query_selector("#pdp-buy .comp-sw.on") is None
               and "Paid only" in page.inner_text("#pdp-buy"))
            page.evaluate("go('dashboard','Discover')")
            page.wait_for_selector(".shelf-tile", timeout=12000)
            # the filter, fixed: comp category now gates on compOpen
            page.click(".filters-fold summary")
            page.select_option("#f-comp", "Restaurant meals")
            page.click(".filters .btn.small-btn")
            page.wait_for_function("document.querySelector('#discover-results').innerText.includes('Maya Rivers')", timeout=10000)
            page.wait_for_timeout(600)
            res = page.inner_text("#discover-results")
            ck("after: comp filter returns comp-open Maya and NOT paid-only Paige",
               "Maya Rivers" in res and "Paige Paidonly" not in res, res[:240])
        ctx.close()
        # ---------- MOBILE: business shelf at 390px ----------
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
            is_mobile=True, device_scale_factor=3, **CTXOPTS)
        login(mctx, "biz@qa136.dev")
        mp = mctx.new_page()
        mp.goto(BASE + "/", wait_until="networkidle")
        mp.evaluate("go('dashboard','Discover')")
        mp.wait_for_selector(".shelf-tile", timeout=15000)
        if BEFORE:
            ck("before (mobile): no switch on tiles either", mp.query_selector(".shelf-tile .comp-sw") is None)
        else:
            ck("after (mobile): switch renders on tiles at 390px",
               mp.query_selector(".shelf-tile .comp-sw") is not None)
        ck("shelf: no horizontal overflow at 390px (" + PHASE + ")", not overflow(mp))
        mp.screenshot(path=f"{OUT}/02-shelf-mobile{SFX}.png")
        mctx.close()
        # ---------- MOBILE: creator setup + live preview ----------
        cctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
            is_mobile=True, device_scale_factor=3, **CTXOPTS)
        login(cctx, "casey@qa136.dev")
        cp = cctx.new_page()
        cp.goto(BASE + "/", wait_until="networkidle")
        cp.evaluate("go('dashboard','Profile')")
        cp.wait_for_selector("#profile-preview-host .shelf-tile", timeout=15000)
        if BEFORE:
            lane = cp.inner_text("#lane-controls") if cp.query_selector("#lane-controls") else ""
            ck("before: the setup switch is labelled only 'Comp visits'",
               "Comp visits" in lane and "I accept comped visits" not in lane, lane[:200])
            ck("before: preview tile carries no accepts-comps switch",
               cp.query_selector("#profile-preview-host .comp-sw") is None)
        else:
            lane = cp.inner_text("#lane-controls")
            ck("after: setup switch carries Jeff's plain-words label + explainer",
               "I accept comped visits" in lane and "comped meal, service, or experience instead of cash" in lane, lane[:260])
            ck("after: preview tile shows the ON switch from the live setup state",
               cp.query_selector("#profile-preview-host .comp-sw.on") is not None
               and "Accepts comps" in cp.inner_text("#profile-preview-host"))
            # flip the real setup switch off: the preview must follow,
            # because both read the one compOpen field.
            cp.click("#lane-comp")
            cp.wait_for_function("document.querySelector('#profile-preview-host').innerText.includes('Paid only')", timeout=10000)
            ck("after: flipping the setup switch off flips the preview card to Paid only",
               cp.query_selector("#profile-preview-host .comp-sw.on") is None)
            cp.click("#lane-comp")
            cp.wait_for_function("document.querySelector('#profile-preview-host').innerText.includes('Accepts comps')", timeout=10000)
            ck("after: flipping it back on restores Accepts comps in the preview", True)
        ck("profile: no horizontal overflow at 390px (" + PHASE + ")", not overflow(cp))
        pel = cp.query_selector("#profile-preview-panel")
        pel.screenshot(path=f"{OUT}/05-setup-preview-mobile{SFX}.png")
        cctx.close()
        browser.close()
finally:
    srv.terminate()

print(f"\nQA build136 [{PHASE}]: {'ALL PASS' if not fails else 'FAILURES: ' + ' | '.join(fails)}")
sys.exit(1 if fails else 0)
