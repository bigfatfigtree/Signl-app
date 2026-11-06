#!/usr/bin/env python3
"""Build -135 fresh-eyes UX pass QA: before/after rendered checks on the
shopping surfaces Jeff ordered audited (Shelf header/filters, PDP rights +
97% lines, compare tray, Mirror, setup preview toggles).

Usage: qa-build135.py [before|after]
  before — asserts the -134 (defect) copy is present, screenshots -before.
  after  — asserts the fixed copy is present and defect copy is gone.
Screenshots land in ~/workspace/research_notes/signl-build135-uxpass-qa/.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request

PHASE = sys.argv[1] if len(sys.argv) > 1 else "after"
assert PHASE in ("before", "after")
BEFORE = PHASE == "before"

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build135-uxpass-qa")
PORT = 9089
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)
SFX = "-before" if BEFORE else "-after"

PW = "qa-pass-135"
SALT = "qa135salt"
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
data["user:bizqa"] = u("bizqa", role="business", email="biz@qa135.dev", name="QA Cuts Owner",
    market="Hampton Roads", business={"businessName": "QA Cuts", "legalName": "QA Cuts LLC",
    "category": "Beauty & Grooming", "address": "100 Ghent Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550100", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["user:trackbiz"] = u("trackbiz", role="business", email="track@qa135.dev", name="Track Owner",
    market="Hampton Roads", business={"businessName": "Track Record Tacos", "legalName": "TRT LLC",
    "category": "Restaurant", "address": "200 Colley Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550101", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["user:mayabakes"] = u("mayabakes", role="creator", email="maya@qa135.dev", name="Maya Rivers", city="Norfolk", market="Hampton Roads",
    creator={"name": "Maya Rivers", "handle": "mayabakes", "platform": "Instagram",
    "handleNormalized": "mayabakes", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ghent", "zip": "23510", "categories": ["Food & Drink"], "tierBand": "Locals",
    "totalAudience": 10000, "audienceStack": {"instagram": 10000}, "platformFollowers": {"instagram": 10000},
    "localAudiencePct": 86, "paidRate": 150, "compOpen": True, "profileComplete": True,
    "publicPage": True, "bio": "Norfolk baker. Sourdough, cakes, and the farmers market.",
    "avgViews": 4200, "topAudienceCities": ["Norfolk", "Virginia Beach"],
    "audienceMarkets": [{"market": "Hampton Roads", "pct": 86}],
    "bestWork": ["https://www.instagram.com/reel/Cabc123XYZ/"]})
data["user:noahnew"] = u("noahnew", role="creator", email="noah@qa135.dev", name="Noah New", city="Norfolk", market="Hampton Roads",
    creator={"name": "Noah New", "handle": "noahnew", "platform": "TikTok",
    "handleNormalized": "noahnew", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ocean View", "zip": "23503", "categories": ["Fitness"], "tierBand": "Neighbors",
    "totalAudience": 3000, "audienceStack": {"tiktok": 3000}, "platformFollowers": {"tiktok": 3000},
    "localAudiencePct": 64, "compOpen": True, "profileComplete": True, "publicPage": True,
    "bio": "Beach workouts and sunrise runs.", "audienceMarkets": [{"market": "Hampton Roads", "pct": 64}]})
data["user:casey"] = u("casey", role="creator", email="casey@qa135.dev", name="Casey Creates", city="Norfolk", market="Hampton Roads",
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

tmp = tempfile.mkdtemp(prefix="signl-qa135-")
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

CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
               ignore_https_errors=True)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        # ---------- DESKTOP: business Shelf header/filters ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(ctx, "biz@qa135.dev")
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_selector(".shelf-tile", timeout=15000)
        page.evaluate("window.scrollTo(0,0)")
        opts = page.eval_on_selector_all("#f-sort option", "els => els.map(e => e.textContent.trim())")
        tier_label = page.evaluate("document.querySelector('#f-tier').closest('div').querySelector('label').textContent.trim()")
        comp_label = page.evaluate("document.querySelector('#f-comp').closest('div').querySelector('label').textContent.trim()")
        if BEFORE:
            ck("before: sort options carry the bare insider terms", "Momentum" in opts and "Local Impact Score" in opts and "Founding order" in opts, str(opts))
            ck("before: tier filter is the bare word Tier", tier_label == "Tier", tier_label)
            ck("before: comp filter says '(comp fit)'", "comp fit" in comp_label, comp_label)
        else:
            ck("after: sort options are plain words", opts[0].startswith("Best local fit") and "most local first" in opts[0]
               and "Founding order (first to join)" in opts and "Reliability (Momentum)" in opts
               and "Local Impact Score" not in opts and "Momentum" not in opts, str(opts))
            ck("after: tier filter explains itself", tier_label == "Tier (their audience size)", tier_label)
            ck("after: comp filter is plain words", comp_label == "Would accept as a comped visit", comp_label)
        page.screenshot(path=f"{OUT}/01-shelf-desktop{SFX}.png")
        # save both -> tray
        page.click(".shelf-tile:nth-child(1) .shelf-save")
        page.wait_for_function("document.querySelectorAll('.shelf-tile').length === 2", timeout=8000)
        page.click(".shelf-tile:nth-child(2) .shelf-save")
        page.wait_for_selector(".shelf-tray", timeout=8000)
        tray = page.inner_text(".shelf-tray")
        if BEFORE:
            ck("before: tray never says WHY one is Top match", "highest share of local followers" not in tray, tray[:200])
        else:
            ck("after: tray says why: highest share of local followers", "highest share of local followers" in tray, tray[:240])
            ck("after: tray Top match tag still on the best column",
               page.query_selector(".shelf-tray-col.top-match .top-match-tag") is not None)
        tray_el = page.query_selector(".shelf-tray")
        tray_el.screenshot(path=f"{OUT}/03-tray-desktop{SFX}.png")
        # ---------- PDP: Maya (paid) buy box 97% line ----------
        page.click(".shelf-tile .shelf-name")
        page.wait_for_selector(".pdp-hero", timeout=12000)
        buy = page.inner_text("#pdp-buy")
        if BEFORE:
            ck("before: buy box states 97% with no reason", "They keep 97%" in buy and "card and transfer fees" not in buy, buy[:240])
        else:
            ck("after: buy box explains the 3%", "card and transfer fees" in buy and "They keep 97%" in buy, buy[:260])
        page.screenshot(path=f"{OUT}/02-pdp-desktop{SFX}.png")
        # ---------- PDP: Noah (comp-only) What you get rights line ----------
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_selector(".shelf-tile", timeout=12000)
        page.click(".shelf-tile:nth-child(2) .shelf-name")
        page.wait_for_selector(".pdp-hero", timeout=12000)
        body = page.inner_text("body")
        if BEFORE:
            ck("before: comped rights say 'native share only'", "native share only" in body)
        else:
            ck("after: comped rights are plain words", "their own page only" in body and "native share" not in body)
            buy2 = page.inner_text("#pdp-buy")
            ck("after: comped lane in buy box is plain words too", "their own page only" in buy2 and "native share" not in buy2, buy2[:240])
        page.screenshot(path=f"{OUT}/02b-pdp-comp-desktop{SFX}.png")
        # ---------- composer preview ----------
        page.evaluate("go('dashboard','Campaign Setup')")
        page.wait_for_selector("#offer-preview-host", timeout=15000)
        page.fill("#o2-title", "QA dinner for two")
        page.wait_for_function("document.querySelector('#offer-preview-host').innerText.includes('QA dinner for two')", timeout=8000)
        pv = page.inner_text("#offer-preview-panel")
        ck("composer: preview toggles ride along (both phases)", "See it as a creator" in pv and "See it as a business" in pv, pv[:200])
        page.query_selector("#offer-preview-panel").screenshot(path=f"{OUT}/06-composer-preview-desktop{SFX}.png")
        ctx.close()
        # ---------- MOBILE: creator Mirror + profile preview ----------
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
            is_mobile=True, device_scale_factor=3, **CTXOPTS)
        login(mctx, "casey@qa135.dev")
        mp = mctx.new_page()
        mp.goto(BASE + "/", wait_until="networkidle")
        mp.evaluate("go('dashboard','Find Offers')")
        mp.wait_for_selector(".mirror-card", timeout=15000)
        foc = mp.inner_text("#cr-findoffers")
        if BEFORE:
            ck("before: paid card keeps 97% unexplained", "you keep 97%" in foc and "card + transfer fees" not in foc, foc[:300])
        else:
            ck("after: paid card explains the 3%", "card + transfer fees" in foc, foc[:300])
        ck("mirror: no horizontal overflow at 390px", not overflow(mp))
        mp.screenshot(path=f"{OUT}/04-mirror-mobile{SFX}.png")
        # profile live preview + toggles
        mp.evaluate("go('dashboard','Profile')")
        mp.wait_for_selector("#profile-preview-host .shelf-tile", timeout=15000)
        panel = mp.inner_text("#profile-preview-panel")
        if BEFORE:
            ck("before: toggle says 'See your public page top'", "See your public page top" in panel, panel[:200])
        else:
            ck("after: toggles are plain words", "Your card" in panel and "Top of your page" in panel
               and "See your public page top" not in panel and "See it as a business" not in panel, panel[:220])
        mp.click('.pv-chip[data-pv="public"]')
        mp.wait_for_function("document.querySelector('#profile-preview-host').innerText.includes('neighbors who could actually walk')", timeout=8000)
        ck("profile preview: page-top view still renders the hero (both phases)", True)
        ck("profile: no horizontal overflow at 390px", not overflow(mp))
        mp.query_selector("#profile-preview-panel").screenshot(path=f"{OUT}/05-profile-preview-mobile{SFX}.png")
        mctx.close()
        browser.close()
finally:
    srv.terminate()

print(f"\nQA build135 [{PHASE}]: {'ALL PASS' if not fails else 'FAILURES: ' + ' | '.join(fails)}")
sys.exit(1 if fails else 0)
