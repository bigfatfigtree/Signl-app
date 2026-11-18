#!/usr/bin/env python3
"""Build -139 (post-138 fix batch) rendered QA.

Asserts CONTENT, not just captures, for Items 1, 3, 4, 5, 6, 7,
8, 9, 10, 12. Screenshots land in .qa139/shots/.
"""
import base64, io, json, os, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.join(APP, ".qa139", "shots")
PORT = 9139
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)

PW = "qa-pass-139"
SALT = "qa139salt"
HASH = subprocess.run(["node", "-e",
    "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
    PW, SALT], capture_output=True, text=True, check=True).stdout.strip()
ADMIN_EMAIL, ADMIN_PW = "admin@qa139.dev", "qa139-admin-pass"

def png_bytes(w, h, rgb, label_rgb):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (w, h), rgb)
    d = ImageDraw.Draw(img)
    d.ellipse([w * 0.3, h * 0.2, w * 0.7, h * 0.8], fill=label_rgb)
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

PORTRAIT = png_bytes(600, 800, (58, 96, 140), (240, 220, 180))   # a photo-shaped image
WIDELOGO = png_bytes(1200, 300, (240, 240, 235), (20, 120, 90))  # a wide logo-shaped image

def u(uid, **kw):
    d = {"id": uid, "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
         "createdAt": "2026-09-01T00:00:00.000Z", "tester": False}
    d.update(kw); return d

def creator(uid, email, name, handle, pct, total, cats, extra=None, cextra=None):
    c = {"handle": handle, "platform": "Instagram", "handleNormalized": handle,
         "market": "Nashville", "city": "Nashville", "state": "TN", "neighborhood": "Germantown",
         "zip": "37201", "categories": cats, "tierBand": "Locals",
         "compCategories": ["Restaurant meals"], "totalAudience": total,
         "audienceStack": {"instagram": total}, "platformFollowers": {"instagram": total},
         "localAudiencePct": pct, "paidRate": 150, "compOpen": True, "couponOpen": True,
         "profileComplete": True, "publicPage": True, "bio": f"{name} — Nashville local.",
         "avgViews": 3000, "audienceMarkets": [{"market": "Nashville", "pct": pct}]}
    if cextra: c.update(cextra)
    d = u(uid, role="creator", email=email, name=name, city="Nashville", market="Nashville", creator=c)
    if extra: d.update(extra)
    return d

data = {}
data["user:bizsalt"] = u("bizsalt", role="business", email="saltline@qa139.dev", name="Salt Line Owner",
    market="Nashville", tester=True,
    business={"businessName": "Salt Line Test Kitchen", "legalName": "SLTK LLC", "category": "Restaurant",
              "address": "100 Union St", "city": "Nashville", "state": "TN", "zip": "37201",
              "neighborhood": "Downtown", "phone": "6155550100", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["user:crmain"] = creator("crmain", "main@qa139.dev", "Maya Main", "mayamain", 86, 10000, ["Food & Drink"])
data["user:crphoto"] = creator("crphoto", "photo@qa139.dev", "Pete Photo", "petephoto", 72, 6000, ["Food & Drink"], cextra={"hasPhoto": True})
data["user:crlogo"] = creator("crlogo", "logo@qa139.dev", "Lena Logo", "lenalogo", 64, 4000, ["Food & Drink"], cextra={"hasPhoto": True})
data["user:crnone"] = creator("crnone", "none@qa139.dev", "Ned None", "nednone", 58, 3000, ["Fitness"])
data["user:crtester"] = creator("crtester", "hello@xmedium.co", "Tess Tester", "tesstester", 80, 8000, ["Food & Drink"], extra={"tester": True})
data["user:crreal"] = creator("crreal", "real@qa139.dev", "Rita Real", "ritareal", 77, 7000, ["Food & Drink"])
data["photo:crphoto"] = {"contentType": "image/png", "dataBase64": PORTRAIT, "bytes": 1000, "uploadedAt": "2026-09-02T00:00:00.000Z"}
data["photo:crlogo"] = {"contentType": "image/png", "dataBase64": WIDELOGO, "bytes": 1000, "uploadedAt": "2026-09-02T00:00:00.000Z"}
for uid in ["bizsalt", "crmain", "crphoto", "crlogo", "crnone", "crtester", "crreal"]:
    data[f"email:{data['user:'+uid]['email']}"] = {"userId": uid}

tmp = tempfile.mkdtemp(prefix="signl-qa139-")
dbpath = os.path.join(tmp, "db.json")
with open(dbpath, "w") as f: json.dump(data, f)
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=dbpath, SIGNL_MAIL_STUB="1",
           APP_URL=BASE, ADMIN_EMAIL=ADMIN_EMAIL, ADMIN_PASSWORD=ADMIN_PW,
           SIGNL_TEST_ALLOW_BUSINESS="1")
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=APP, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = []
def ck(name, cond, extra=""):
    print(("  ok " if cond else "FAIL ") + name + (f" :: {extra}" if extra and not cond else ""))
    if not cond: fails.append(name)

def login(ctx, email, pw=PW):
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw},
                         headers={"Content-Type": "application/json"})
    assert r.ok, f"login {email}: {r.status}"

def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")

CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
               ignore_https_errors=True)

try:
    for i in range(120):
        try:
            import urllib.request
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])

        # ---------- seed test offers via the real Admin action ----------
        actx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(actx, ADMIN_EMAIL, ADMIN_PW)
        r = actx.request.post(BASE + "/api/admin/test-offers/load", data={},
                              headers={"Content-Type": "application/json"})
        ck("I12 seed via Admin action", r.ok and r.json().get("result", {}).get("created") == 6,
           r.text()[:200] if r.ok else str(r.status))

        # ---------- Item 10: markets memo timing (API level) ----------
        t0 = time.time(); actx.request.get(BASE + "/api/admin/markets"); cold = (time.time() - t0) * 1000
        t0 = time.time(); actx.request.get(BASE + "/api/admin/markets"); warm = (time.time() - t0) * 1000
        print(f"  markets cold={cold:.0f}ms warm(memo)={warm:.0f}ms")
        ck("I10 second markets read is memoized (faster than cold)", warm < cold, f"cold={cold:.0f} warm={warm:.0f}")

        # ---------- Admin home: Item 1 alignment + Item 10 paint speed ----------
        apage = actx.new_page()
        t0 = time.time()
        apage.goto(BASE + "/", wait_until="domcontentloaded")
        apage.wait_for_function("document.querySelector('#ah-highlights') && document.querySelector('#ah-highlights').innerText.includes('signed up')", timeout=20000)
        paint_ms = (time.time() - t0) * 1000
        print(f"  admin home highlights painted in {paint_ms:.0f}ms (rig)")
        ck("I10 admin home highlights paint with values", paint_ms < 15000, f"{paint_ms:.0f}ms")
        edges = apage.evaluate("""() => [...document.querySelectorAll('#ah-highlights .hl137-num')].map(e => e.getBoundingClientRect().right)""")
        ck("I1 admin highlight values share one right edge", len(edges) >= 3 and max(edges) - min(edges) <= 1.5, str(edges))
        ck("I1 admin home no horizontal overflow", not overflow(apage))
        apage.screenshot(path=f"{OUT}/01-admin-home-desktop.png")

        # ---------- Item 3: Stats five-way toggle ----------
        apage.evaluate("go('dashboard','Stats')")
        apage.wait_for_selector("#astview-creators", timeout=15000)
        apage.wait_for_function("document.querySelector('#ast-charts') && document.querySelector('#ast-charts').innerText.trim().length > 20", timeout=20000)
        def view_visible(v):
            return apage.evaluate(f"getComputedStyle(document.querySelector('#astview-{v}')).display !== 'none'")
        ck("I3 default view is Creators with content", view_visible("creators") and not view_visible("revenue"))
        apage.click("#tab-body .ws-tabs button:text-is('Revenue')")
        apage.wait_for_timeout(600)
        rev = apage.inner_text("#astview-revenue")
        ck("I3 Revenue view shows the honest revenue state", "Collected so far" in rev and "Founding pipeline" in rev, rev[:160])
        ck("I3 Revenue view hides Creators", not view_visible("creators") and view_visible("revenue"))
        apage.click("#tab-body .ws-tabs button:text-is('Website')")
        apage.wait_for_timeout(600)
        ck("I3 Website view shows the GA section", view_visible("website") and len(apage.inner_text("#astview-website").strip()) > 10)
        apage.click("#tab-body .ws-tabs button:text-is('Businesses') >> nth=0")
        apage.wait_for_function("document.querySelector('#cc-body') && document.querySelector('#cc-body').innerText.trim().length > 10", timeout=15000)
        ck("I3 Businesses view shows the books", view_visible("books") and len(apage.inner_text("#cc-body").strip()) > 10)
        apage.click("#tab-body .ws-tabs button:text-is('Partners') >> nth=0")
        apage.wait_for_timeout(600)
        ck("I3 Partners view shows the books (partners tab)", view_visible("books"))
        apage.click("#tab-body .ws-tabs button:text-is('Creators')")
        apage.wait_for_timeout(400)
        ck("I3 back to Creators", view_visible("creators"))
        ck("I3 Stats no horizontal overflow", not overflow(apage))
        apage.screenshot(path=f"{OUT}/02-admin-stats-revenue.png")

        # ---------- Business: homes, Find creators (I1, I4, I5, I6) ----------
        bctx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(bctx, "saltline@qa139.dev")
        bpage = bctx.new_page()
        bpage.goto(BASE + "/", wait_until="networkidle")
        bpage.wait_for_selector(".hl137-num", timeout=15000)
        edges = bpage.evaluate("""() => [...document.querySelectorAll('.hl137-num')].map(e => e.getBoundingClientRect().right)""")
        ck("I1 business highlight values share one right edge", len(edges) >= 2 and max(edges) - min(edges) <= 1.5, str(edges))
        bpage.evaluate("go('dashboard','Discover')")
        bpage.wait_for_selector(".shelf-tile", timeout=15000)
        bpage.wait_for_function("document.querySelector('#discover-results').innerText.includes('Pete Photo')", timeout=10000)
        # Item 5: shelf media heights equal across photo / logo / none
        heights = bpage.evaluate("""() => { const out = {};
          for (const t of document.querySelectorAll('.shelf-tile')) {
            const ph = t.querySelector('.shelf-photo'); if (ph) out[t.innerText.split('\\n')[0]] = ph.getBoundingClientRect().height;
          } return out; }""")
        hs = list(heights.values())
        ck("I5 shelf media heights equal across image kinds", len(hs) >= 3 and max(hs) - min(hs) <= 2, str(heights))
        logo_fit = bpage.evaluate("""() => { const t = [...document.querySelectorAll('.shelf-tile')].find(x => x.innerText.includes('Lena Logo'));
          const img = t && t.querySelector('img.shelf-photo-img'); return img ? img.className + '|' + getComputedStyle(img).objectFit : 'no-img'; }""")
        ck("I5 wide logo on a shelf tile is contained, not cover-cropped", "media-contain" in logo_fit and "contain" in logo_fit, logo_fit)
        bpage.screenshot(path=f"{OUT}/03-find-creators-desktop.png")
        # Item 4: rail scrolls independently
        rail = bpage.evaluate("""() => { const r = document.querySelector('#disc-rail'); if (!r) return null;
          const before = window.scrollY; r.scrollTop = r.scrollHeight;
          const groups = r.querySelectorAll('.df-group'); const last = groups[groups.length - 1];
          const rr = r.getBoundingClientRect(); const lr = last.getBoundingClientRect();
          return { scrollY: window.scrollY, before, canScroll: r.scrollHeight > r.clientHeight,
                   lastVisible: lr.bottom <= rr.bottom + 2 && lr.top >= rr.top - 2 }; }""")
        ck("I4 rail scrolls to its last group with the page unmoved", rail and rail["canScroll"] and rail["scrollY"] == rail["before"] and rail["lastVisible"], str(rail))
        bpage.screenshot(path=f"{OUT}/04-find-creators-rail-scrolled.png")

        # Item 8: PDP (desktop) — open Maya Main
        bpage.evaluate("window.scrollTo(0,0)")
        bpage.evaluate("openCreatorProfile('crmain')")
        bpage.wait_for_selector(".pdp-hero", timeout=10000)
        body = bpage.inner_text("#tab-body")
        ck("I8 PDP: no Momentum explainer paragraph", "is a reliability score" not in body)
        ck("I8 PDP: no Local Impact formula line", "Local Impact Score, in the open" not in body)
        ck("I8 PDP: one clean location line, no chip soup", bpage.query_selector(".cc-loc") is not None and bpage.query_selector(".cc-chips") is None)
        ck("I8 PDP: hero % block present with numbers", "%" in bpage.inner_text(".pdp-hero"))
        ck("I8 PDP: Book + Save reachable at the top (desktop)", bpage.query_selector(".pdp-topacts") is not None)
        ck("I8 PDP: What you get keeps 4 short lines incl. booking-terms due line", "Due by the terms on the booking" in body)
        ck("I8 PDP: NO standards paragraph under What you get (terms live in booking)", "The visit itself" not in body and "Every SIGNL comped visit includes" not in body)
        # Item 5 on Similar creators
        sim = bpage.evaluate("""() => { const cards = [...document.querySelectorAll('.pdp-sim')];
          return { n: cards.length, hs: cards.map(c => c.getBoundingClientRect().height),
                   media: cards.map(c => { const m = c.querySelector('.pdp-sim-img'); return m ? m.tagName + '|' + getComputedStyle(m).objectFit : 'none'; }) }; }""")
        ck("I5 similar cards render with equal heights", sim["n"] >= 2 and max(sim["hs"]) - min(sim["hs"]) <= 2, str(sim))
        bpage.screenshot(path=f"{OUT}/05-pdp-desktop.png", full_page=True)

        # Item 6: Start a campaign beside Find creators
        bpage.evaluate("go('dashboard','Campaign Setup')")
        bpage.wait_for_selector(".camp-layout", timeout=15000)
        dims = bpage.evaluate("""() => { const rail = document.querySelector('.camp-rail'); const wrap = document.querySelector('.camp-wrap');
          return { railW: rail.getBoundingClientRect().width, wrapW: wrap.getBoundingClientRect().width,
                   maxW: getComputedStyle(wrap).maxWidth, picks: document.querySelectorAll('.camp-rail .camp-pick').length }; }""")
        ck("I6 campaign rail is 272px like Find creators", abs(dims["railW"] - 272) <= 3, str(dims))
        ck("I6 campaign page carries the 1180px max-width constraint (binds on wide screens; body here is 1000px)", dims["maxW"] == "1180px" and dims["wrapW"] <= 1180, str(dims))
        camp_text = bpage.inner_text(".camp-layout")
        ck("I6 plays/templates are ONE labelled rail group, not pills", "play or template" in camp_text.lower() and dims["picks"] >= 4, str(dims))
        ck("I6 Standard Visit is a summary line + quiet expander, no mint block", bpage.query_selector(".pkg-mint") is None and "Every comped offer runs on" in camp_text and "The Standard Visit, in full" in camp_text)
        ck("I6 lane choice is a segmented control", bpage.query_selector("#offer-composer .bookseg") is not None)
        ck("I6 campaign page no horizontal overflow", not overflow(bpage))
        bpage.screenshot(path=f"{OUT}/06-campaign-desktop.png", full_page=True)

        # ---------- Mobile 390px: I7 + I8 sticky bar + I1 ----------
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, **CTXOPTS)
        login(mctx, "saltline@qa139.dev")
        mpage = mctx.new_page()
        mpage.goto(BASE + "/", wait_until="networkidle")
        mpage.wait_for_selector(".hl137-num", timeout=15000)
        edges = mpage.evaluate("""() => [...document.querySelectorAll('.hl137-num')].map(e => e.getBoundingClientRect().right)""")
        ck("I1 business highlights aligned at 390px", len(edges) >= 2 and max(edges) - min(edges) <= 1.5, str(edges))
        ck("I1 no overflow at 390px (business home)", not overflow(mpage))
        mpage.evaluate("go('dashboard','Discover')")
        mpage.wait_for_selector(".shelf-tile", timeout=15000)
        ck("I7 mobile Find creators: NO category chip row", mpage.query_selector(".shop-chiprow") is None)
        mpage.screenshot(path=f"{OUT}/07-find-creators-390.png")
        mpage.click("#disc-rail-btn")
        mpage.wait_for_selector("#disc-rail.open", timeout=8000)
        sheet = mpage.evaluate("document.querySelector('#disc-rail').textContent")
        ck("I7 mobile sheet carries the Category group", "category" in sheet.lower())
        before = mpage.inner_text("#discover-count")
        box = mpage.query_selector("[data-dcat-box='Food & Drink']")
        ck("I7 category checkbox exists in the sheet", box is not None)
        if box: box.click()
        mpage.wait_for_timeout(900)
        after = mpage.inner_text("#discover-count")
        btn = mpage.inner_text("#disc-rail-btn")
        ck("I7 picking a category in the sheet narrows results + counts on the Filters button", before != after or "1" in btn, f"before={before!r} after={after!r} btn={btn!r}")
        mpage.screenshot(path=f"{OUT}/08-find-creators-390-sheet.png")
        mpage.evaluate("shopRailToggle('disc-rail')")
        # PDP on mobile: sticky Book/Save bar
        mpage.evaluate("openCreatorProfile('crmain')")
        mpage.wait_for_selector(".pdp-actionbar", timeout=10000)
        bar = mpage.evaluate("""() => { const b = document.querySelector('.pdp-actionbar'); const r = b.getBoundingClientRect();
          return { display: getComputedStyle(b).display, text: b.innerText, bottom: r.bottom, vh: window.innerHeight }; }""")
        ck("I8 mobile PDP: sticky Book + Save bar visible", bar["display"] != "none" and "Book" in bar["text"] and "Save" in bar["text"] and bar["bottom"] <= bar["vh"], str(bar))
        overlap = mpage.evaluate("""() => { const ring = document.querySelector('.cc-photo.no-photo .cc-mono span');
          const pill = document.querySelector('.cc-photo .cc-paid'); if (!ring || !pill) return 'n/a';
          const a = ring.getBoundingClientRect(), b = pill.getBoundingClientRect();
          return (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) ? 'OVERLAP' : 'clear'; }""")
        ck("I8 mobile PDP: monogram ring never collides with the paid pill", overlap != "OVERLAP", str(overlap))
        mpage.screenshot(path=f"{OUT}/09-pdp-390.png")

        # ---------- Creator side: I12 + I9 + I7 (Find offers) ----------
        cctx = browser.new_context(viewport={"width": 390, "height": 844}, **CTXOPTS)
        login(cctx, "hello@xmedium.co")
        cpage = cctx.new_page()
        cpage.goto(BASE + "/", wait_until="networkidle")
        cpage.evaluate("go('dashboard','Find Offers')")
        cpage.wait_for_selector(".mirror-card", timeout=15000)
        cards = cpage.inner_text("#cr-findoffers")
        ck("I12 tester creator's Find offers shows the 3 test offers", all(s in cards for s in ["Dinner for two", "Saturday lunch", "store credit"]), cards[:300])
        ck("I9 mirror cards carry Apply (Grab) + Save on the card", "Grab this visit" in cards and "Save for later" in cards)
        ck("I9/I11 mirror ask uses booking-terms language, no flat 48h promise", "standard goal for a comped visit is within 48 hours" in cards and "within 48 hours of the visit." not in cards, cards[:400])
        ck("I7 mobile Find offers: NO category chip row", cpage.query_selector(".shop-chiprow") is None)
        cpage.screenshot(path=f"{OUT}/10-find-offers-390.png")
        cpage.click("#fo-rail-btn")
        cpage.wait_for_selector("#fo-rail.open", timeout=8000)
        ck("I7 Find offers sheet carries the Category group", "category" in cpage.evaluate("document.querySelector('#fo-rail').textContent").lower())
        cpage.screenshot(path=f"{OUT}/11-find-offers-390-sheet.png")

        rctx = browser.new_context(viewport={"width": 390, "height": 844}, **CTXOPTS)
        login(rctx, "real@qa139.dev")
        rpage = rctx.new_page()
        rpage.goto(BASE + "/", wait_until="networkidle")
        rpage.evaluate("go('dashboard','Find Offers')")
        rpage.wait_for_timeout(1500)
        rtext = rpage.inner_text("#cr-findoffers")
        ck("I12 real creator sees NO test offers (empty board, honest empty state)", "Dinner for two" not in rtext and "No open visits match" in rtext, rtext[:200])
        rpage.screenshot(path=f"{OUT}/12-find-offers-real-creator.png")

        browser.close()
finally:
    server.kill()
print(f"\nQA build139: {len(fails)} failures" + (": " + " | ".join(fails) if fails else ""))
sys.exit(1 if fails else 0)
