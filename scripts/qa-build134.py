#!/usr/bin/env python3
"""Build -134 rendered QA: the Shelf, the creator page, the Mirror, live setup previews.
Seeds a local JSON store, boots the dev server, and drives Chromium via the relay,
ASSERTING component contents (not just screenshots): % hero + spelled-out counts,
price lines, proof lines, compare tray, buy box, ask lines, track strip presence /
absence (empty-section rule), live previews that update as you type, overflow at 390px.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build134-qa")
PORT = 9088
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)

PW = "qa-pass-134"
SALT = "qa134salt"
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
data["user:bizqa"] = u("bizqa", role="business", email="biz@qa134.dev", name="QA Cuts Owner",
    market="Hampton Roads", business={"businessName": "QA Cuts", "legalName": "QA Cuts LLC",
    "category": "Beauty & Grooming", "address": "100 Ghent Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550100", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["user:trackbiz"] = u("trackbiz", role="business", email="track@qa134.dev", name="Track Owner",
    market="Hampton Roads", business={"businessName": "Track Record Tacos", "legalName": "TRT LLC",
    "category": "Restaurant", "address": "200 Colley Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550101", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["user:mayabakes"] = u("mayabakes", role="creator", email="maya@qa134.dev", name="Maya Rivers", city="Norfolk", market="Hampton Roads",
    creator={"name": "Maya Rivers", "handle": "mayabakes", "platform": "Instagram",
    "handleNormalized": "mayabakes", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ghent", "zip": "23510", "categories": ["Food & Drink"], "tierBand": "Locals",
    "totalAudience": 10000, "audienceStack": {"instagram": 10000}, "platformFollowers": {"instagram": 10000},
    "localAudiencePct": 86, "paidRate": 150, "compOpen": True, "profileComplete": True,
    "publicPage": True, "bio": "Norfolk baker. Sourdough, cakes, and the farmers market.",
    "avgViews": 4200, "topAudienceCities": ["Norfolk", "Virginia Beach"],
    "audienceMarkets": [{"market": "Hampton Roads", "pct": 86}],
    "bestWork": ["https://www.instagram.com/reel/Cabc123XYZ/"]})
data["user:noahnew"] = u("noahnew", role="creator", email="noah@qa134.dev", name="Noah New", city="Norfolk", market="Hampton Roads",
    creator={"name": "Noah New", "handle": "noahnew", "platform": "TikTok",
    "handleNormalized": "noahnew", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ocean View", "zip": "23503", "categories": ["Fitness"], "tierBand": "Neighbors",
    "totalAudience": 3000, "audienceStack": {"tiktok": 3000}, "platformFollowers": {"tiktok": 3000},
    "localAudiencePct": 64, "compOpen": True, "profileComplete": True, "publicPage": True,
    "bio": "Beach workouts and sunrise runs.", "audienceMarkets": [{"market": "Hampton Roads", "pct": 64}]})
data["user:casey"] = u("casey", role="creator", email="casey@qa134.dev", name="Casey Creates", city="Norfolk", market="Hampton Roads",
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
data["booking:bk2"] = {"id": "bk2", "creatorId": "casey", "businessId": "trackbiz",
    "creatorName": "Casey Creates", "createdAt": "2026-10-05T00:00:00.000Z",
    "redeemedAt": "2026-10-06T00:00:00.000Z", "status": "redeemed"}
data["post:po1"] = {"id": "po1", "bookingId": "bk1", "creatorId": "mayabakes", "businessId": "trackbiz",
    "createdAt": "2026-10-02T12:00:00.000Z", "onTime": True, "postUrl": "https://www.instagram.com/p/AAA111/"}
data["post:po2"] = {"id": "po2", "bookingId": "bk2", "creatorId": "casey", "businessId": "trackbiz",
    "createdAt": "2026-10-07T12:00:00.000Z", "onTime": False, "postUrl": "https://www.instagram.com/p/BBB222/"}
iso = lambda ms: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ms / 1000))
data["offer:of1"] = {"id": "of1", "businessId": "trackbiz", "businessName": "Track Record Tacos",
    "market": "Hampton Roads", "category": "Restaurant", "lane": "open", "status": "open",
    "kind": "comp", "title": "Taco tasting for two", "whatComped": "A taco tasting for two",
    "dollarCap": 120, "covers": 2, "spots": 3, "createdAt": iso(NOW - 3 * DAY),
    "publishedAt": iso(NOW - 3 * DAY), "deliverables": {"posts": 1, "story": True, "windowHours": 48}}
data["offer:of2"] = {"id": "of2", "businessId": "bizqa", "businessName": "QA Cuts",
    "market": "Hampton Roads", "category": "Restaurant", "lane": "open", "status": "open",
    "kind": "paid", "title": "Launch week post", "cashRate": 150, "spots": 2,
    "createdAt": iso(NOW - 2 * DAY), "publishedAt": iso(NOW - 2 * DAY),
    "deliverables": {"posts": 1, "story": True, "windowHours": 48}}

for k in list(data.keys()):
    if k.startswith("user:"):
        data[f"email:{data[k]['email']}"] = {"userId": data[k]["id"]}

tmp = tempfile.mkdtemp(prefix="signl-qa134-")
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

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        # ---------- DESKTOP: business Shelf ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 860},
            proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
            ignore_https_errors=True)
        login(ctx, "biz@qa134.dev")
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_selector(".shelf-tile", timeout=15000)
        cnt = page.inner_text("#discover-count")
        ck("shelf: live count reads 2 creators", "2 creators" in cnt, cnt)
        tiles = page.query_selector_all(".shelf-tile")
        ck("shelf: two tiles render", len(tiles) == 2, str(len(tiles)))
        t0 = tiles[0].inner_text()
        ck("shelf: best local fit first (Maya, 86%)", "Maya Rivers" in t0 and "86%" in t0, t0[:160])
        ck("shelf: spelled-out local followers", "about 8,600 local followers" in t0, t0[:220])
        ck("shelf: paid rate is the price line", "$150" in t0 and "paid booking" in t0, t0[:220])
        ck("shelf: proof line counts her visits", "1 visit done" in t0 and "100% on time" in t0, t0[:260])
        ck("shelf: follower total demoted, still present", "10k followers total" in t0, t0[:260])
        ck("shelf: first tile wears the top-match box + tag (not a pill)",
           page.evaluate("!!document.querySelector('.shelf-tile.top-match .top-match-tag') && document.querySelector('.shelf-tile.top-match .top-match-tag').textContent.trim() === 'Top match'"))
        # bookmode: paid only -> Maya alone
        page.click('[data-bookmode="paid"]')
        page.wait_for_function("document.querySelectorAll('.shelf-tile').length === 1", timeout=8000)
        ck("shelf: Paid bookings filter narrows to paid creators",
           "1 creator in" in page.inner_text("#discover-count"))
        page.click('[data-bookmode="any"]')
        page.wait_for_function("document.querySelectorAll('.shelf-tile').length === 2", timeout=8000)
        # save both -> tray
        page.click(".shelf-tile:nth-child(1) .shelf-save")
        page.wait_for_function("document.querySelectorAll('.shelf-tile').length === 2", timeout=8000)
        page.click(".shelf-tile:nth-child(2) .shelf-save")
        page.wait_for_selector(".shelf-tray", timeout=8000)
        tray = page.inner_text(".shelf-tray")
        ck("shelf: compare tray marks the top match with the bold box + tag", "Maya Rivers" in tray and page.query_selector(".shelf-tray-col.top-match .top-match-tag") is not None, tray[:200])
        page.screenshot(path=f"{OUT}/01-shelf-desktop.png")
        # ---------- PDP ----------
        page.click(".shelf-tile .shelf-name")
        page.wait_for_selector(".pdp-hero", timeout=12000)
        hero = page.inner_text(".pdp-hero")
        ck("pdp: hero carries the % and the spelled-out neighbors",
           "86%" in hero and "8,600 neighbors" in hero and "walk through your door" in hero, hero[:200])
        body = page.inner_text("body")
        ck("pdp: What you get states 1 post + 1 story", "What you get" in body and "1 post + 1 story" in body)
        ck("pdp: audience specs render", "The audience, in numbers" in body)
        ck("pdp: track record stats render", page.evaluate("document.body.innerHTML.includes('Visits completed') && document.body.innerHTML.includes('On time')"))
        ck("pdp: best work renders (she has a video link)", page.evaluate("document.body.innerHTML.includes('Best work') && !!document.querySelector('.work-embed-frame iframe, .work-card')"))
        ck("pdp: Momentum explainer absent when no points (no fake content)", "Why this score matters" not in body)
        ck("pdp: similar creators rail renders (Noah shares the market)", "Similar creators nearby" in body)
        buy = page.inner_text("#pdp-buy")
        ck("pdp: buy box offers Paid at rate + Comped $0", "Paid booking" in buy and "$150" in buy and "Comped visit" in buy, buy[:200])
        page.click("#pdp-buy .pdp-day:nth-child(2)")
        page.click(".pdp-send")
        page.wait_for_selector("#deal-sheet", timeout=10000)
        note = page.input_value("#ds-notefield")
        ck("pdp: picked day lands in the offer note", note.startswith("Preferred visit day:"), note)
        ck("pdp: deal sheet defaults to the paid lane", page.input_value("#ds-kind") == "paid")
        page.screenshot(path=f"{OUT}/02-pdp-desktop.png", full_page=False)
        # PDP empty sections: Noah has no best work, no record, no reviews
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_selector(".shelf-tile", timeout=12000)
        page.click(".shelf-tile:nth-child(2) .shelf-name")
        page.wait_for_selector(".pdp-hero", timeout=12000)
        body2 = page.inner_text("body")
        ck("pdp: no Best work block when the creator has none", "Best work" not in body2)
        ck("pdp: no reviews block when there are none", "What businesses say" not in body2)
        ck("pdp: hero still honest without a track record", "64%" in page.inner_text(".pdp-hero"))
        # ---------- composer preview ----------
        page.evaluate("go('dashboard','Campaign Setup')")
        page.wait_for_selector("#offer-preview-host", timeout=15000)
        page.fill("#o2-title", "QA dinner for two")
        page.wait_for_function("document.querySelector('#offer-preview-host').innerText.includes('QA dinner for two')", timeout=8000)
        prev = page.inner_text("#offer-preview-host")
        ck("composer: live preview mirrors the title as typed", "QA dinner for two" in prev)
        ck("composer: preview shows the ask line", "The ask:" in prev, prev[:240])
        page.screenshot(path=f"{OUT}/03-composer-preview-desktop.png")
        ctx.close()
        # ---------- public profile ----------
        ctx2 = browser.new_context(viewport={"width": 1280, "height": 860},
            proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
            ignore_https_errors=True)
        pg = ctx2.new_page()
        pg.goto(BASE + "/c/mayabakes", wait_until="networkidle")
        pg.wait_for_selector(".cc-local", timeout=12000)
        loc = pg.inner_text(".cc-local")
        ck("public: neighbors line present with spelled-out count",
           "8,600" in loc and "neighbors who could actually walk through your door" in loc, loc[:240])
        pg.screenshot(path=f"{OUT}/04-public-profile-desktop.png")
        ctx2.close()
        # ---------- MOBILE: creator Mirror + profile preview ----------
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
            is_mobile=True, device_scale_factor=3,
            proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
            ignore_https_errors=True)
        login(mctx, "casey@qa134.dev")
        mp = mctx.new_page()
        mp.goto(BASE + "/", wait_until="networkidle")
        try:
            mp.wait_for_selector('#tabbar button[aria-label="Find offers"]', timeout=10000)
            bar_ok = True
        except Exception:
            bar_ok = False
        ck("mobile: creator phone bar carries Find", bar_ok)
        mp.evaluate("go('dashboard','Find Offers')")
        mp.wait_for_selector(".mirror-card", timeout=15000)
        foc = mp.inner_text("#cr-findoffers")
        ck("mirror: count line is plain words", "2 open visits near you" in foc, foc[:160])
        cards = mp.query_selector_all(".mirror-card")
        ck("mirror: two offer cards render", len(cards) == 2, str(len(cards)))
        alltxt = mp.inner_text("#cr-findoffers")
        ck("mirror: comped offer stated like a price", "Comped taco tasting for two" in alltxt)
        ck("mirror: paid offer stated like a price", "$150 paid" in alltxt)
        ck("mirror: the ask is one plain line", "The ask: 1 post + 1 story within 48 hours of the visit." in alltxt)
        ck("mirror: neighborhood + distance ride along", "Ghent" in alltxt and "Same neighborhood" in alltxt)
        track_card = [c for c in cards if "Track Record Tacos" in c.inner_text()]
        plain_card = [c for c in cards if "QA Cuts" in c.inner_text()]
        ck("mirror: track strip renders for the proven business",
           len(track_card) == 1 and track_card[0].query_selector(".mirror-track") is not None
           and "2 visits hosted" in track_card[0].inner_text())
        ck("mirror: NO track strip for a business with no history (empty-section rule)",
           len(plain_card) == 1 and plain_card[0].query_selector(".mirror-track") is None)
        ck("mirror: no horizontal overflow at 390px", not overflow(mp))
        mp.screenshot(path=f"{OUT}/05-mirror-mobile.png")
        # paid filter
        mp.locator('.chip', has_text='Paid').first.click()
        mp.wait_for_function("document.querySelectorAll('.mirror-card').length === 1", timeout=8000)
        ck("mirror: Paid filter narrows to the paid offer", "$150 paid" in mp.inner_text("#cr-findoffers"))
        # profile live preview
        mp.evaluate("go('dashboard','Profile')")
        mp.wait_for_selector("#profile-preview-host .shelf-tile", timeout=15000)
        pv = mp.inner_text("#profile-preview-host")
        ck("profile preview: renders the creator's own shelf card", "Casey Creates" in pv and "72%" in pv, pv[:200])
        mp.fill("#p-name", "Casey Changed")
        mp.wait_for_function("document.querySelector('#profile-preview-host').innerText.includes('Casey Changed')", timeout=8000)
        ck("profile preview: updates live as the name is edited", True)
        mp.click('.pv-chip[data-pv="public"]')
        mp.wait_for_function("document.querySelector('#profile-preview-host').innerText.includes('neighbors who could actually walk')", timeout=8000)
        ck("profile preview: public view shows the hero neighbors line", True)
        ck("profile: no horizontal overflow at 390px", not overflow(mp))
        mp.screenshot(path=f"{OUT}/06-profile-preview-mobile.png")
        mctx.close()
        # ---------- MOBILE shelf (business) ----------
        bctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
            is_mobile=True, device_scale_factor=3,
            proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
            ignore_https_errors=True)
        login(bctx, "biz@qa134.dev")
        bp = bctx.new_page()
        bp.goto(BASE + "/", wait_until="networkidle")
        bp.evaluate("go('dashboard','Discover')")
        bp.wait_for_selector(".shelf-tile", timeout=15000)
        ck("mobile shelf: tiles render + no overflow", not overflow(bp))
        bp.screenshot(path=f"{OUT}/07-shelf-mobile.png")
        bctx.close()
        browser.close()
finally:
    srv.terminate()

print(f"\nQA build134: {'ALL PASS' if not fails else 'FAILURES: ' + ' | '.join(fails)}")
sys.exit(1 if fails else 0)
