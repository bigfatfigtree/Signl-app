#!/usr/bin/env python3
"""Build -136 QA, scopes #2-#8 (rendered, content-asserting).

Drives the real app on the local dev server: shelf acceptance
switches (comps + coupons), the peek switches, the jump-nav,
My offers, Find creators rail layout + filter mechanics, Find
offers rail + counts, the Sig campaign guide end to end, the
dedicated booking flow, the deal extras line landing on the
creator's card, and the offer-photo nudge + Mirror cover.

Screenshots land in ~/workspace/research_notes/signl-build136-qa/.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build136-qa")
PORT = 9091
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)

PW = "qa-pass-136"
SALT = "qa136salt"
HASH = subprocess.run(["node", "-e",
    "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
    PW, SALT], capture_output=True, text=True, check=True).stdout.strip()
PNG1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

def u(uid, **kw):
    d = {"id": uid, "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
         "createdAt": "2026-09-01T00:00:00.000Z", "tester": False}
    d.update(kw); return d

data = {}
data["user:bizqa"] = u("bizqa", role="business", email="biz@qa136.dev", name="QA Cuts Owner",
    market="Hampton Roads", business={"businessName": "QA Cuts", "legalName": "QA Cuts LLC",
    "category": "Beauty & Grooming", "address": "100 Ghent Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550100", "website": "", "accessState": "active"},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["user:trackbiz"] = u("trackbiz", role="business", email="track@qa136.dev", name="Track Owner",
    market="Hampton Roads", business={"businessName": "Track Record Tacos", "legalName": "TRT LLC",
    "category": "Restaurant", "address": "200 Colley Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550101", "website": "", "hasPhoto": True, "photoCount": 1},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["photo:trackbiz"] = {"contentType": "image/png", "dataBase64": PNG1, "bytes": 68, "uploadedAt": "2026-10-01T00:00:00.000Z"}
# Maya: comps ON, coupons OFF, paid rate -> two chips, one lit.
data["user:mayabakes"] = u("mayabakes", role="creator", email="maya@qa136.dev", name="Maya Rivers", city="Norfolk", market="Hampton Roads",
    creator={"name": "Maya Rivers", "handle": "mayabakes", "platform": "Instagram",
    "handleNormalized": "mayabakes", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ghent", "zip": "23510", "categories": ["Food & Drink"], "tierBand": "Locals",
    "compCategories": ["Restaurant meals"],
    "totalAudience": 10000, "audienceStack": {"instagram": 10000}, "platformFollowers": {"instagram": 10000},
    "localAudiencePct": 86, "paidRate": 150, "compOpen": True, "couponOpen": False, "profileComplete": True,
    "publicPage": True, "bio": "Norfolk baker. Sourdough, cakes, and the farmers market.",
    "avgViews": 4200, "topAudienceCities": ["Norfolk", "Virginia Beach"],
    "audienceMarkets": [{"market": "Hampton Roads", "pct": 86}],
    "bestWork": ["https://www.instagram.com/reel/Cabc123XYZ/"]})
# Noah: comp-only, coupons unset (default on).
data["user:noahnew"] = u("noahnew", role="creator", email="noah@qa136.dev", name="Noah New", city="Norfolk", market="Hampton Roads",
    creator={"name": "Noah New", "handle": "noahnew", "platform": "TikTok",
    "handleNormalized": "noahnew", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ocean View", "zip": "23503", "categories": ["Fitness"], "tierBand": "Neighbors",
    "compCategories": ["Fitness classes & passes"],
    "totalAudience": 3000, "audienceStack": {"tiktok": 3000}, "platformFollowers": {"tiktok": 3000},
    "localAudiencePct": 64, "compOpen": True, "profileComplete": True, "publicPage": True,
    "bio": "Beach workouts and sunrise runs.", "audienceMarkets": [{"market": "Hampton Roads", "pct": 64}]})
# Paige: comps OFF, coupons ON, paid rate.
data["user:paigepaid"] = u("paigepaid", role="creator", email="paige@qa136.dev", name="Paige Paidonly", city="Norfolk", market="Hampton Roads",
    creator={"name": "Paige Paidonly", "handle": "paigepaid", "platform": "Instagram",
    "handleNormalized": "paigepaid", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ghent", "zip": "23517", "categories": ["Beauty & Grooming"], "tierBand": "Neighbors",
    "compCategories": ["Restaurant meals"],
    "totalAudience": 5000, "audienceStack": {"instagram": 5000}, "platformFollowers": {"instagram": 5000},
    "localAudiencePct": 78, "paidRate": 200, "compOpen": False, "couponOpen": True, "profileComplete": True,
    "publicPage": True, "bio": "Norfolk beauty creator.",
    "audienceMarkets": [{"market": "Hampton Roads", "pct": 78}]})
# Pat: BOTH off -> the single "Paid only" chip.
data["user:patboth"] = u("patboth", role="creator", email="pat@qa136.dev", name="Pat Paidonly", city="Norfolk", market="Hampton Roads",
    creator={"name": "Pat Paidonly", "handle": "patpaid", "platform": "Instagram",
    "handleNormalized": "patpaid", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ghent", "zip": "23517", "categories": ["Fitness"], "tierBand": "Neighbors",
    "compCategories": [],
    "totalAudience": 4000, "audienceStack": {"instagram": 4000}, "platformFollowers": {"instagram": 4000},
    "localAudiencePct": 70, "paidRate": 175, "compOpen": False, "couponOpen": False, "profileComplete": True,
    "publicPage": True, "bio": "Paid bookings only, either way.",
    "audienceMarkets": [{"market": "Hampton Roads", "pct": 70}]})
# Casey: the creator whose setup + peek we drive.
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
# The open offer on the Mirror: from the photo'd business, with
# Jeff's extras line verbatim.
data["offer:of1"] = {"id": "of1", "businessId": "trackbiz", "businessName": "Track Record Tacos",
    "market": "Hampton Roads", "category": "Restaurant", "kind": "comp",
    "title": "Taco night for two", "whatComped": "Two taco plates and two drinks",
    "includes": "Mats, towels and the smoothie after are on us", "experience": "",
    "dollarCap": 60, "covers": 2, "spots": 3, "status": "open",
    "createdAt": "2026-11-05T12:00:00.000Z", "publishedAt": "2026-11-05T12:00:00.000Z",
    "visitWindow": "Any evening this week",
    "deliverables": {"posts": 1, "story": True, "windowHours": 48}, "targetTiers": []}

for k in list(data.keys()):
    if k.startswith("user:"):
        data[f"email:{data[k]['email']}"] = {"userId": data[k]["id"]}

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

CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
               ignore_https_errors=True)
EXTRAS = "Mats, towels and the smoothie after are on us"

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        # ================= BUSINESS DESKTOP =================
        ctx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(ctx, "biz@qa136.dev")
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")

        # ---- nav order: Find creators -> Start a campaign -> Your campaigns
        page.evaluate("go('dashboard','Home')")
        page.wait_for_function("document.querySelectorAll('.tab-item').length > 3", timeout=15000)
        nav_order = page.evaluate("""() => { const all = [...document.querySelectorAll('.tab-item')];
          const idx = l => all.findIndex(e => (e.innerText || '').trim().startsWith(l));
          return [idx('Find creators'), idx('Start a campaign'), idx('Your campaigns')]; }""")
        ck("nav: rail order is Find creators, then Start a campaign, then Your campaigns",
           -1 < nav_order[0] < nav_order[1] < nav_order[2], str(nav_order))
        ck("nav: no 'Set up a campaign' label anywhere", "Set up a campaign" not in page.inner_text("body"))

        # ---- Find creators: rail layout on desktop
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_selector(".shelf-tile", timeout=15000)
        page.wait_for_function("document.querySelector('#discover-results').innerText.includes('Pat Paidonly')", timeout=10000)
        ck("shop: desktop shows the left filter rail",
           page.locator("#disc-rail").is_visible())
        rail_labels = page.evaluate("document.querySelector('#disc-rail').textContent")
        for lab in ["Where", "What kind of creator", "Must-haves", "How you want to book", "All categories", "All creators"]:
            ck(f"shop: rail group piece present: {lab}", lab in rail_labels)
        ck("shop: booking control is the segmented control, not chips",
           page.query_selector('#disc-rail .bookseg [data-bookmode="comp"]') is not None
           and page.query_selector('#disc-rail .bookseg .dcat-chip') is None)
        ck("shop: must-haves are switches",
           page.query_selector('#dchip-spanish') is not None and page.query_selector('#dchip-spanish').get_attribute("type") == "checkbox")
        page.screenshot(path=f"{OUT}/08-find-creators-desktop-after.png", full_page=True)

        # ---- acceptance switches: all four states
        maya = tile(page, "Maya Rivers"); paige = tile(page, "Paige Paidonly")
        pat = tile(page, "Pat Paidonly"); noah = tile(page, "Noah New")
        ck("accept: Maya (comps on, coupons off) shows two switches, comps lit",
           maya.locator(".comp-sw").count() == 2
           and maya.locator('.comp-sw[aria-label="Accepts comps: yes"]').count() == 1
           and maya.locator('.comp-sw[aria-label="Accepts coupons: no"]').count() == 1, maya.inner_text()[:240])
        ck("accept: Paige (comps off, coupons on) shows coupons lit, comps muted",
           paige.locator('.comp-sw[aria-label="Accepts comps: no"]').count() == 1
           and paige.locator('.comp-sw[aria-label="Accepts coupons: yes"]').count() == 1, paige.inner_text()[:240])
        ck("accept: Pat (both off) collapses to the single Paid only chip",
           pat.locator(".comp-sw").count() == 1 and "Paid only" in pat.inner_text()
           and pat.locator(".comp-sw.on").count() == 0, pat.inner_text()[:240])
        ck("accept: Noah (comp-only, coupons default on) keeps Comped visit line + lit switches",
           "Comped visit" in noah.inner_text() and noah.locator(".comp-sw.on").count() == 2, noah.inner_text()[:240])
        chip = maya.locator(".shelf-localcount")
        ck("accept: count chip under the % with the spelled-out count",
           chip.count() == 1 and "about 8,600 local followers" in chip.inner_text())
        # tray acceptance row
        maya.locator(".shelf-save").click()
        page.wait_for_timeout(400)
        tile(page, "Paige Paidonly").locator(".shelf-save").click()
        page.wait_for_selector(".shelf-tray", timeout=8000)
        tray_txt = page.inner_text(".shelf-tray")
        ck("accept: compare tray carries its own acceptance row with both switches",
           page.query_selector(".shelf-tray .shelf-tray-acc .comp-sw") is not None
           and "Accepts comps" in tray_txt and "Accepts coupons" in tray_txt, tray_txt[:240])
        page.query_selector(".shelf-tray").screenshot(path=f"{OUT}/04-tray-desktop-after.png")

        # ---- booking-type filtering in the rail
        tiles = lambda: page.evaluate("[...document.querySelectorAll('#discover-results .shelf-tile')].map(e => e.innerText).join(' | ')")
        page.click('#disc-rail [data-bookmode="paid"]')
        page.wait_for_function("[...document.querySelectorAll('#discover-results .shelf-tile')].every(e => !e.innerText.includes('Noah New'))", timeout=10000)
        res = tiles()
        ck("filter: Paid booking hides the comp-only creator, keeps paid ones",
           "Noah New" not in res and "Maya Rivers" in res and "Pat Paidonly" in res, res[:200])
        page.click('#disc-rail [data-bookmode="comp"]')
        page.wait_for_function("[...document.querySelectorAll('#discover-results .shelf-tile')].every(e => !e.innerText.includes('Paige Paidonly'))", timeout=10000)
        res = tiles()
        ck("filter: Comped visit hides paid-only creators (Paige + Pat), keeps comp-open ones",
           "Paige Paidonly" not in res and "Pat Paidonly" not in res and "Maya Rivers" in res and "Noah New" in res, res[:200])
        page.click('#disc-rail [data-bookmode="any"]')
        page.wait_for_function("[...document.querySelectorAll('#discover-results .shelf-tile')].some(e => e.innerText.includes('Paige Paidonly'))", timeout=10000)

        # ---- PDP buy box switches
        tile(page, "Maya Rivers").locator(".shelf-name").click()
        page.wait_for_selector(".pdp-hero", timeout=12000)
        ck("pdp: buy box carries both acceptance switches",
           page.query_selector("#pdp-buy .comp-sw") is not None
           and page.locator('#pdp-buy .comp-sw[aria-label="Accepts comps: yes"]').count() == 1)
        page.screenshot(path=f"{OUT}/03-pdp-desktop-after.png", full_page=True)

        # ---- dedicated booking flow (Scope #4D + #6 extras)
        page.click("#pdp-buy .pdp-send")
        page.wait_for_selector("#deal-sheet-host", state="attached", timeout=10000)
        page.wait_for_function("document.querySelector('#tab-body').innerText.includes('Step 1')", timeout=10000)
        bk = page.inner_text("#tab-body")
        ck("book: Book opens the dedicated flow, NOT the campaign form",
           page.query_selector("#offer-composer") is None and "Book Maya" in bk and "Step 1" in bk, bk[:200])
        ck("book: Sig chat box sits at the top of the booking flow",
           page.query_selector("#tab-body .sig-ask-form, #tab-body [class*=sig]") is not None)
        page.click("input[name='bk-lane'][value='comp']")
        page.click("button:has-text('Continue')")
        page.wait_for_selector("#deal-sheet", timeout=10000)
        ck("book: Continue opens the deal sheet with the comp lane preselected",
           page.input_value("#ds-kind") == "comp")
        page.fill("#ds-cap", "100")
        page.fill("#ds-what", "Dinner for two, on us")
        page.fill("#ds-includes", EXTRAS)
        page.click("button:has-text('Send the deal')")
        page.wait_for_function("document.querySelector('#ds-note') && document.querySelector('#ds-note').innerText.length > 2", timeout=10000)
        ck("book: the deal sends (same /deals record as always)",
           "Deal sent" in page.inner_text("#ds-note") or "booked" in page.inner_text("#ds-note").lower(),
           page.inner_text("#ds-note"))
        page.screenshot(path=f"{OUT}/07-booking-desktop-after.png", full_page=True)

        # ---- Start a campaign: layout, starters, photo nudge
        page.evaluate("go('dashboard','Campaign Setup')")
        page.wait_for_selector("#campaign-guide", timeout=12000)
        order = page.evaluate("""() => { const g = document.querySelector('#campaign-guide').getBoundingClientRect().top;
          const hs = [...document.querySelectorAll('h3')].find(h => h.innerText.trim() === 'Templates');
          const c = document.querySelector('#offer-composer').getBoundingClientRect().top;
          return [g, hs ? hs.getBoundingClientRect().top : null, c]; }""")
        ck("campaign: Sig first, Templates directly under, manual form below",
           order[1] is not None and order[0] < order[1] < order[2], str(order))
        guide_txt = page.inner_text("#campaign-guide")
        ck("campaign: starter examples sit under Sig, in Jeff's shapes",
           "Find me 15 creators who would take a comped meal" in guide_txt and "fashion lovers" in guide_txt, guide_txt[:200])
        ck("campaign: no-photo business gets the photo nudge",
           page.query_selector("#biz-photo-block") is not None and "Offers with a photo get picked first" in page.inner_text("#biz-photo-block"))
        ck("campaign: view title reads Start a campaign", "Start a campaign" in page.inner_text("#tab-body")[:400])

        # ---- the Sig guide, end to end (parser + conversation + save + walk)
        parsed = page.evaluate("campaignGuideParse('I will pay 3 creators $100 each, I want fashion lovers')")
        ck("guide parse: paid + 3 spots + $100 from one sentence",
           parsed.get("kind") == "paid" and parsed.get("spots") == 3 and parsed.get("amount") == 100, json.dumps(parsed))
        parsed2 = page.evaluate("campaignGuideParse('find me spanish speaking women creators for a comped brunch')")
        ck("guide parse: spanish + comp spotted; gender words flagged for the honesty line only",
           parsed2.get("spanish") is True and parsed2.get("kind") == "comp" and parsed2.get("trait") is True, json.dumps(parsed2))
        page.fill("#cg-text", "pay 2 creators $100")
        page.click("#campaign-guide button[type='submit']")
        page.wait_for_selector("#cg-thread .sig-turn", timeout=8000)
        answers = {"call it": "QA Taco Night", "included": EXTRAS, "come in": "This weekend"}
        for _ in range(14):
            thread = page.inner_text("#cg-thread")
            if "See the creators who match" in thread: break
            low = thread.lower()
            acted = False
            for key, val in answers.items():
                if key in low.split("qa taco night")[-1] or (key == "call it" and "call it" in low):
                    pass
            # answer by the LAST sig question (the chips row is a
            # sig bubble too — skip any bubble holding buttons)
            last = page.evaluate("""() => { const t = [...document.querySelectorAll('#cg-thread .sig-turn.sig .sig-bub')].filter(b => !b.querySelector('button'));
              return t.length ? t[t.length-1].innerText : ''; }""")
            ll = last.lower()
            # chips first: a step with an actionable chip is a chip
            # step (text steps carry no actionable chip — Skip only)
            btns = page.locator("#cg-thread .sig-turn-act")
            clicked = False
            for i in range(btns.count()):
                t = btns.nth(i).inner_text()
                if any(k in t for k in ["Keep as shown", "Standard", "Done", "Save this draft", "Cash"]):
                    btns.nth(i).click(); clicked = True; break
            if clicked:
                acted = True
            elif "call it" in ll or "name" in ll and "campaign" in ll:
                page.fill("#cg-text", "QA Taco Night"); page.click("#campaign-guide button[type='submit']"); acted = True
            elif "creator get" in ll:
                page.fill("#cg-text", "Dinner for two, on us"); page.click("#campaign-guide button[type='submit']"); acted = True
            elif "included" in ll:
                page.fill("#cg-text", EXTRAS); page.click("#campaign-guide button[type='submit']"); acted = True
            elif "come in" in ll or "when" in ll:
                page.fill("#cg-text", "This weekend"); page.click("#campaign-guide button[type='submit']"); acted = True
            if not acted: break
            page.wait_for_timeout(500)
        thread = page.inner_text("#cg-thread")
        ck("guide: the summary carried the composed extras line before saving",
           ("Included: " + EXTRAS) in thread, thread[-400:])
        ck("guide: the conversation ends saved, with the matched-creators walk offered",
           "See the creators who match" in thread and "Saved" in thread, thread[-300:])
        page.screenshot(path=f"{OUT}/06-guide-desktop-after.png", full_page=True)
        page.click("button:has-text('See the creators who match')")
        page.wait_for_selector(".shelf-tile", timeout=12000)
        ck("guide: the walk lands on Find creators", page.query_selector("#disc-rail") is not None)
        page.evaluate("go('dashboard','My Offers')")
        page.wait_for_timeout(1200)
        seg = page.locator("button", has_text="Drafts")
        if seg.count(): seg.first.click(); page.wait_for_timeout(800)
        ck("guide: the saved draft is real — it sits in Your campaigns under the parsed title",
           "Pay 2 creators $100" in page.inner_text("#tab-body"), page.inner_text("#tab-body")[:300])
        ctx.close()

        # ================= CREATOR DESKTOP: MAYA =================
        mctx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(mctx, "maya@qa136.dev")
        mp = mctx.new_page()
        mp.goto(BASE + "/", wait_until="networkidle")
        # ---- My offers: no deck, pointer card, new name
        mp.evaluate("go('dashboard','Offers')")
        mp.wait_for_selector("#cr-offers-segs", timeout=12000)
        body = mp.inner_text("#tab-body")
        ck("offers: the legacy deck is gone (no board, no Cards/List toggle)",
           mp.query_selector("#open-board") is None and "Open offers in" not in body, body[:240])
        ck("offers: ONE pointer card to Find offers where the deck sat",
           "Looking for offers open to every creator in your market?" in body)
        ck("offers: the view is named My offers (title + rail)",
           "My offers" in body[:300])
        # the deal from the booking flow shows its extras line
        deals_seg = mp.locator("#cr-offers-segs button", has_text="Deals")
        if deals_seg.count():
            deals_seg.first.click(); mp.wait_for_timeout(1200)
            dtxt = mp.inner_text("#tab-body")
            ck("book: the creator's deal card shows the extras line word for word",
               EXTRAS in dtxt and "Included" in dtxt, dtxt[:400])
        mp.screenshot(path=f"{OUT}/13-myoffers-desktop-after.png", full_page=True)
        mp.click("button:has-text('Find offers')")
        mp.wait_for_selector(".mirror-grid, .mirror-card", timeout=12000)
        # ---- Find offers: rail layout, counts, cover photo, extras
        ck("mirror: desktop shows the left rail with the concept groups",
           mp.locator("#fo-rail").is_visible())
        frail = mp.evaluate("document.querySelector('#fo-rail').textContent")
        for lab in ["The offer", "All offers", "Category", "All categories", "Distance from you", "Good to know"]:
            ck(f"mirror: rail piece present: {lab}", lab in frail)
        ck("mirror: kind counts are real (All offers (1), Comped visit (1))",
           "All offers (1)" in frail and "Comped visit (1)" in frail, frail[:300])
        card = mp.locator(".mirror-card", has_text="Taco night for two").first
        ck("mirror: the offer card leads with the business's photo",
           card.locator("img.mirror-cover").count() == 1
           and "/api/users/trackbiz/photo" in (card.locator("img.mirror-cover").get_attribute("src") or ""),
           card.inner_text()[:200])
        ck("mirror: the extras line renders word for word on the card",
           EXTRAS in card.inner_text() and "Included:" in card.inner_text(), card.inner_text()[:300])
        mp.click('#fo-rail [data-fokind="paid"]')
        mp.wait_for_timeout(700)
        ck("mirror: Paid post filter empties the comp-only list (filtering works)",
           "Taco night for two" not in mp.inner_text("#cr-findoffers"))
        mp.click('#fo-rail [data-fokind="all"]')
        mp.wait_for_timeout(700)
        ck("mirror: All offers restores the list", "Taco night for two" in mp.inner_text("#cr-findoffers"))
        mp.screenshot(path=f"{OUT}/10-find-offers-desktop-after.png", full_page=True)
        mctx.close()

        # ================= CREATOR SETUP: CASEY (desktop) =================
        cctx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(cctx, "casey@qa136.dev")
        cp = cctx.new_page()
        cp.goto(BASE + "/", wait_until="networkidle")
        cp.evaluate("go('dashboard','Profile')")
        cp.wait_for_selector("#profile-peek-sw", timeout=15000)
        ck("peek: ONE switch at the top with Jeff's exact label; old preview box gone",
           "See how businesses view you" in cp.inner_text("#tab-body")[:1500]
           and cp.query_selector("#profile-preview-panel") is None)
        strip = cp.inner_text("#tab-body")
        for lab in ["Basics", "About you", "Photos", "Your links", "Your audience", "What you create", "Rates", "Bio"]:
            ck(f"jump-nav: pill present: {lab}", lab in strip)
        cp.click("#profile-peek-sw")
        cp.wait_for_selector("#profile-peek .shelf-tile", timeout=10000)
        peek = cp.inner_text("#profile-peek")
        ck("peek ON: card + full page render with Casey's real values (72%, count chip, both switches)",
           "72%" in peek and "about 7,200 local followers" in peek
           and 'Accepts comps' in peek and 'Accepts coupons' in peek, peek[:300])
        ck("peek ON: the editing form is hidden while peeking",
           not cp.locator("#profile-edit-wrap").is_visible())
        tile_box = cp.locator("#profile-peek .shelf-tile").bounding_box()
        ck("peek ON: the card renders at shelf width, not squeezed into a grid third",
           tile_box is not None and tile_box["width"] >= 280, str(tile_box))
        cp.screenshot(path=f"{OUT}/12-peek-desktop-after.png", full_page=True)
        cp.click("#profile-peek-sw")
        cp.wait_for_timeout(400)
        ck("peek OFF: the editing form returns", cp.locator("#profile-edit-wrap").is_visible())
        # coupon flip in setup changes the card after save (peek reads live state)
        cp.click("#lane-coupon")
        cp.wait_for_timeout(900)
        cp.click("#profile-peek-sw")
        cp.wait_for_selector("#profile-peek .shelf-tile", timeout=10000)
        ck("peek: flipping the coupon switch off in setup flips the preview card's coupon switch",
           cp.locator('#profile-peek .shelf-tile .comp-sw[aria-label="Accepts coupons: no"]').count() == 1
           and cp.locator('#profile-peek .shelf-tile .comp-sw[aria-label="Accepts coupons: yes"]').count() == 0)
        cp.click("#profile-peek-sw"); cp.wait_for_timeout(300)
        cp.click("#lane-coupon"); cp.wait_for_timeout(900)  # restore
        cctx.close()

        # ================= MOBILE 390: BUSINESS =================
        bctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
            is_mobile=True, device_scale_factor=3, **CTXOPTS)
        login(bctx, "biz@qa136.dev")
        bp = bctx.new_page()
        bp.goto(BASE + "/", wait_until="networkidle")
        bp.evaluate("go('dashboard','Discover')")
        bp.wait_for_selector(".shelf-tile", timeout=15000)
        ck("mobile shop: sticky bar with Filters button; rail hidden until tapped",
           bp.locator(".shop-mbar").is_visible() and not bp.locator("#disc-rail").is_visible())
        bp.click("#disc-rail-btn")
        bp.wait_for_timeout(500)
        ck("mobile shop: Filters opens the sheet with every group, same words",
           bp.locator("#disc-rail.open").is_visible()
           and all(x in bp.evaluate("document.querySelector('#disc-rail').textContent") for x in ["Where", "What kind of creator", "Must-haves", "How you want to book"]))
        bp.click('#disc-rail [data-bookmode="paid"]')
        bp.click("#disc-rail .rail-foot .btn")
        bp.wait_for_function("[...document.querySelectorAll('#discover-results .shelf-tile')].every(e => !e.innerText.includes('Noah New'))", timeout=10000)
        ck("mobile shop: a filter chosen in the sheet actually filters",
           "Noah New" not in bp.evaluate("[...document.querySelectorAll('#discover-results .shelf-tile')].map(e => e.innerText).join(' ')"))
        ck("mobile shop: no horizontal overflow at 390px", not overflow(bp))
        bp.click("#disc-rail-btn"); bp.wait_for_timeout(400)
        bp.screenshot(path=f"{OUT}/09-find-creators-mobile-after.png")
        bctx.close()

        # ================= MOBILE 390: CREATOR FIND OFFERS =================
        fctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
            is_mobile=True, device_scale_factor=3, **CTXOPTS)
        login(fctx, "maya@qa136.dev")
        fp = fctx.new_page()
        fp.goto(BASE + "/", wait_until="networkidle")
        fp.evaluate("go('dashboard','Find Offers')")
        fp.wait_for_selector(".mirror-card", timeout=12000)
        ck("mobile mirror: sticky bar present, cards stack full width",
           fp.locator(".shop-mbar").is_visible() and not fp.locator("#fo-rail").is_visible())
        fp.click("#fo-rail-btn")
        fp.wait_for_timeout(500)
        sheet = fp.evaluate("document.querySelector('#fo-rail').textContent")
        ck("mobile mirror: the sheet holds every group with its All option first",
           fp.locator("#fo-rail.open").is_visible()
           and all(x in sheet for x in ["The offer", "All offers", "Category", "Distance from you", "Good to know"]), sheet[:240])
        fp.click('#fo-rail [data-fokind="paid"]')
        fp.click("#fo-rail .rail-foot .btn")
        fp.wait_for_timeout(800)
        ck("mobile mirror: Paid chosen in the sheet filters the comp offer out",
           "Taco night for two" not in fp.inner_text("#cr-findoffers"))
        ck("mobile mirror: no horizontal overflow at 390px", not overflow(fp))
        fp.click("#fo-rail-btn"); fp.wait_for_timeout(400)
        fp.screenshot(path=f"{OUT}/11-find-offers-mobile-after.png")
        fctx.close()
        browser.close()
finally:
    srv.terminate()

print(f"\nQA build136b: {'ALL PASS' if not fails else 'FAILURES: ' + ' | '.join(fails)}")
sys.exit(1 if fails else 0)
