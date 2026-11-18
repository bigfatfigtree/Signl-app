#!/usr/bin/env python3
"""Build -140 (held batch) rendered QA — Items A-F.

Asserts CONTENT, not just captures. Screenshots land in
.qa140/shots/ (copied to research_notes for the report).
"""
import base64, io, json, os, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.join(APP, ".qa140", "shots")
PORT = 9141
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)

PW = "qa-pass-140"
SALT = "qa140salt"
HASH = subprocess.run(["node", "-e",
    "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
    PW, SALT], capture_output=True, text=True, check=True).stdout.strip()
ADMIN_EMAIL, ADMIN_PW = "admin@qa140.dev", "qa140-admin-pass"

def png_bytes(w, h, rgb, label_rgb):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (w, h), rgb)
    d = ImageDraw.Draw(img)
    d.ellipse([w * 0.25, h * 0.1, w * 0.75, h * 0.9], fill=label_rgb)
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

PORTRAIT = png_bytes(600, 800, (58, 96, 140), (240, 220, 180))    # photo 0.75
WIDELOGO = png_bytes(1200, 600, (240, 240, 235), (20, 120, 90))   # wide logo 2.0 (the dead-band case)
SQUARE = png_bytes(800, 800, (245, 245, 240), (180, 60, 90))      # square logo 1.0

def u(uid, **kw):
    d = {"id": uid, "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
         "createdAt": "2026-09-01T00:00:00.000Z", "tester": False}
    d.update(kw); return d

def creator(uid, email, name, handle, market, city, pct, stack, cats, extra=None, cextra=None):
    c = {"handle": handle, "platform": "Instagram", "handleNormalized": handle,
         "city": city, "state": "TN", "neighborhood": "Germantown",
         "categories": cats, "tierBand": "Locals",
         "compCategories": ["Restaurant meals"],
         "audienceStack": stack, "totalAudience": sum(stack.values()),
         "followerCount": stack.get("instagram", 0),
         "localAudiencePct": pct, "paidRate": 150, "compOpen": True, "couponOpen": True,
         "profileComplete": True, "publicPage": True, "bio": f"{name} — local.",
         "avgViews": 3000, "audienceMarkets": []}
    if cextra: c.update(cextra)
    d = u(uid, role="creator", email=email, name=name, city=city, market=market, creator=c)
    if extra: d.update(extra)
    return d

data = {}
data["user:bizsalt"] = u("bizsalt", role="business", email="saltline@qa140.dev", name="Salt Line Owner",
    market="Nashville", tester=True,
    business={"businessName": "Salt Line Test Kitchen", "legalName": "SLTK LLC", "category": "Restaurant",
              "address": "100 Union St", "city": "Nashville", "state": "TN", "zip": "37201",
              "neighborhood": "Downtown", "phone": "6155550100", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})

# Similar pool (Nashville, Food & Drink): pct order Pete 90 > Ned 89 > Lena 88 > Sara 87 > Kesha 82
data["user:crpete"] = creator("crpete", "pete@qa140.dev", "Pete Photo", "petephoto", "Nashville", "Nashville", 90,
    {"instagram": 6000}, ["Food & Drink"], cextra={"hasPhoto": True, "instagramUrl": "https://instagram.com/petephoto"})
data["user:crned"] = creator("crned", "ned@qa140.dev", "Ned None", "nednone", "Nashville", "Nashville", 89,
    {"instagram": 3000}, ["Food & Drink"], cextra={"instagramUrl": "https://instagram.com/nednone"})
data["user:crlena"] = creator("crlena", "lena@qa140.dev", "Lena Logo", "lenalogo", "Nashville", "Nashville", 88,
    {"instagram": 4000}, ["Food & Drink"], cextra={"hasPhoto": True, "instagramUrl": "https://instagram.com/lenalogo"})
data["user:crsara"] = creator("crsara", "sara@qa140.dev", "Sara Square", "sarasquare", "Nashville", "Nashville", 87,
    {"instagram": 4500}, ["Food & Drink"], cextra={"hasPhoto": True, "instagramUrl": "https://instagram.com/sarasquare"})
data["user:crkesha"] = creator("crkesha", "kesha@qa140.dev", "Kesha Local", "keshalocal", "Nashville", "Nashville", 82,
    {"instagram": 28000}, ["Food & Drink"],
    cextra={"instagramUrl": "https://instagram.com/keshalocal", "topAudienceCities": ["Nashville", "Memphis"]})
# Item E math: IG 10k @82 (rate) + TikTok 40k (no rate)
data["user:crmax"] = creator("crmax", "max@qa140.dev", "Max Math", "maxmath", "Nashville", "Nashville", 82,
    {"instagram": 10000, "tiktok": 40000}, ["Food & Drink"],
    cextra={"platformLocalPct": {"instagram": 82}, "instagramUrl": "https://instagram.com/maxmath",
            "tiktokHandle": "maxmathtt", "tiktokUrl": "https://www.tiktok.com/@maxmathtt"})
# Item E section: home Hampton Roads 60 + Nashville 12 + Austin 7 (listed in Nashville via the 12)
data["user:crgia"] = creator("crgia", "gia@qa140.dev", "Gia Geo", "giageo", "Hampton Roads", "Virginia Beach", 60,
    {"instagram": 9000}, ["Food & Drink"],
    cextra={"platformLocalPct": {"instagram": 60}, "instagramUrl": "https://instagram.com/giageo",
            "audienceMarkets": [{"market": "Nashville", "pct": 12}, {"market": "Austin", "pct": 7}]})
data["user:crgia"]["creator"]["state"] = "VA"
# Home-only creator (quiet geography state), Hampton Roads
data["user:crhank"] = creator("crhank", "hank@qa140.dev", "Hank Home", "hankhome", "Hampton Roads", "Norfolk", 55,
    {"instagram": 5000}, ["Fitness"], cextra={"instagramUrl": "https://instagram.com/hankhome"})
data["user:crhank"]["creator"]["state"] = "VA"
# Item F: 7 platforms entered, Reddit count-only (no link -> no pill)
data["user:crpam"] = creator("crpam", "pam@qa140.dev", "Pam Platforms", "pamplatforms", "Nashville", "Nashville", 70,
    {"instagram": 28000, "facebook": 5000, "tiktok": 40000, "youtube": 12000, "twitch": 3000, "pinterest": 2000, "reddit": 1500},
    ["Food & Drink"],
    cextra={"instagramUrl": "https://instagram.com/pamplatforms",
            "facebookUrl": "https://www.facebook.com/pamplatforms",
            "tiktokHandle": "pamplatforms", "tiktokUrl": "https://www.tiktok.com/@pamplatforms",
            "youtubeChannel": "https://www.youtube.com/@pamplatforms",
            "platformLinks": {"twitch": {"handle": "pamplatforms", "url": "https://www.twitch.tv/pamplatforms"},
                              "pinterest": {"handle": "pamplatforms", "url": "https://www.pinterest.com/pamplatforms"}}})
# Sig prompt + setup completion: no local %, no audienceMarkets key at all
fred = creator("crfred", "fred@qa140.dev", "Fred Fresh", "fredfresh", "Nashville", "Nashville", None,
    {"instagram": 8000}, ["Food & Drink"], cextra={"instagramUrl": "https://instagram.com/fredfresh"})
del fred["creator"]["audienceMarkets"]
data["user:crfred"] = fred
# Tester creator for the Find offers board
data["user:crtester"] = creator("crtester", "hello@xmedium.co", "Tess Tester", "tesstester", "Nashville", "Nashville", 80,
    {"instagram": 8000}, ["Food & Drink"], extra={"tester": True}, cextra={"instagramUrl": "https://instagram.com/tesstester"})

data["photo:crpete"] = {"contentType": "image/png", "dataBase64": PORTRAIT, "bytes": 1000, "uploadedAt": "2026-09-02T00:00:00.000Z"}
data["photo:crlena"] = {"contentType": "image/png", "dataBase64": WIDELOGO, "bytes": 1000, "uploadedAt": "2026-09-02T00:00:00.000Z"}
data["photo:crsara"] = {"contentType": "image/png", "dataBase64": SQUARE, "bytes": 1000, "uploadedAt": "2026-09-02T00:00:00.000Z"}
for uid in ["bizsalt", "crpete", "crned", "crlena", "crsara", "crkesha", "crmax", "crgia", "crhank", "crpam", "crfred", "crtester"]:
    data[f"email:{data['user:'+uid]['email']}"] = {"userId": uid}

tmp = tempfile.mkdtemp(prefix="signl-qa140-")
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

def wait_fit(page, sel, timeout=8000):
    """Wait until fitRails has fitted this rail (measured
    --rail-off present). The campaign rail re-renders when its
    async Sig brief lands; measuring before the refit races it."""
    page.wait_for_function(
        """(sel) => { const r = document.querySelector(sel);
           return !!r && r.style.getPropertyValue('--rail-off') !== ''; }""",
        arg=sel, timeout=timeout)
    page.wait_for_timeout(250)

RAIL_JS = """(sel) => { const r = document.querySelector(sel); if (!r) return null;
  window.scrollTo(0, 0); r.scrollTop = 0;
  const restTop = Math.round(r.getBoundingClientRect().top);
  const canScroll = r.scrollHeight > r.clientHeight + 1;
  r.scrollTop = r.scrollHeight;
  // The rail's last GROUP is the unit of reachability; picks are
  // controls inside groups (on the campaign rail the last pick
  // sits mid-rail, so groups win when both exist).
  const gEls = [...r.querySelectorAll('.df-group')].filter(g => g.getBoundingClientRect().height > 0);
  const pEls = [...r.querySelectorAll('.camp-pick')].filter(g => g.getBoundingClientRect().height > 0);
  const last = gEls.length ? gEls[gEls.length - 1] : (pEls.length ? pEls[pEls.length - 1] : r.lastElementChild);
  const rr = r.getBoundingClientRect();
  const inside = () => { const lr = last.getBoundingClientRect(); return lr.bottom <= rr.bottom + 2 && lr.top >= rr.top - 2; };
  let lastVisible = inside();
  if (!lastVisible && last.offsetParent === r) {
    // Reachability, not framing: a real user stops scrolling
    // when the group is framed, which can be a few px above max
    // scroll when the rail has trailing padding. Align the
    // group's bottom to the rail's bottom edge and re-measure.
    r.scrollTop = Math.max(0, last.offsetTop + last.offsetHeight - r.clientHeight);
    lastVisible = inside();
  }
  if (!lastVisible && last.offsetHeight > r.clientHeight + 2) {
    // A group taller than the rail's window can never be framed
    // whole at ANY scroll position (the campaign rail at a 760px
    // viewport: 189-211px window, 201px last group). Jeff's
    // standard is that the last group is fully REACHABLE by the
    // rail's own scroll: its end reaches the rail's bottom edge
    // at max scroll, and its start reaches the rail's top edge —
    // every control in it can be seen and used, page unmoved.
    r.scrollTop = r.scrollHeight;
    const lb = last.getBoundingClientRect();
    const endOk = lb.bottom <= rr.bottom + 2 && lb.top < rr.bottom;
    r.scrollTop = Math.max(0, last.offsetTop - 4);
    const lt = last.getBoundingClientRect();
    const startOk = lt.top >= rr.top - 2 && lt.top < rr.bottom;
    lastVisible = endOk && startOk;
  }
  return { restTop, canScroll, scrollY: window.scrollY, railBottom: Math.round(rr.bottom), vh: window.innerHeight,
           off: r.style.getPropertyValue('--rail-off'), lastVisible }; }"""

try:
    for i in range(120):
        try:
            import urllib.request
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])

        # ---------- seed test offers (for the Find offers board) ----------
        actx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(actx, ADMIN_EMAIL, ADMIN_PW)
        r = actx.request.post(BASE + "/api/admin/test-offers/load", data={},
                              headers={"Content-Type": "application/json"})
        ck("seed test offers via Admin action", r.ok and r.json().get("result", {}).get("created") == 6,
           r.text()[:160] if r.ok else str(r.status))

        # ---------- ITEM A: Find offers rail at Jeff's size (1875x949) ----------
        fctx = browser.new_context(viewport={"width": 1875, "height": 949}, **CTXOPTS)
        login(fctx, "hello@xmedium.co")
        fpage = fctx.new_page()
        fpage.goto(BASE + "/", wait_until="networkidle")
        fpage.evaluate("go('dashboard','Find Offers')")
        fpage.wait_for_selector("#fo-rail", timeout=15000)
        fpage.wait_for_selector(".mirror-card", timeout=15000)
        fpage.wait_for_timeout(500)
        wait_fit(fpage, "#fo-rail")
        rail = fpage.evaluate(RAIL_JS, "#fo-rail")
        ck("A Find offers @1875: rail fitted with a measured --rail-off", rail and rail["off"] not in ("", None) and int(rail["off"].replace("px", "")) > 100, str(rail))
        ck("A Find offers @1875: rail box ends inside the viewport", rail and rail["railBottom"] <= rail["vh"] + 1, str(rail))
        ck("A Find offers @1875: last rail group reachable by rail scroll alone (page unmoved)",
           rail and rail["lastVisible"] and rail["scrollY"] == 0, str(rail))
        fpage.screenshot(path=f"{OUT}/01-find-offers-rail-1875.png")
        # filter still narrows: Paid post radio -> 1 of 3
        # (the fo-kind radios carry no value attribute; the lane
        # lives in their onchange — order is all/comp/paid/coupon)
        before = fpage.inner_text(".fo-count")
        fpage.evaluate("window.scrollTo(0,0)")
        radios = fpage.query_selector_all("input[name='fo-kind']")
        ck("A Find offers: the lane radios exist in the rail", len(radios) == 4, str(len(radios)))
        if len(radios) == 4: radios[2].click()
        fpage.wait_for_timeout(900)
        after = fpage.inner_text(".fo-count")
        ck("A Find offers: picking Paid post narrows the board", before != after and after.startswith("1 "), f"before={before!r} after={after!r}")
        radios = fpage.query_selector_all("input[name='fo-kind']")
        if radios: radios[0].click()
        fpage.wait_for_timeout(700)

        # ---------- ITEM A: Find offers rail at 1440x760 (must be a real scroll container) ----------
        fpage.set_viewport_size({"width": 1440, "height": 760})
        fpage.wait_for_timeout(600)
        wait_fit(fpage, "#fo-rail")
        rail = fpage.evaluate(RAIL_JS, "#fo-rail")
        ck("A Find offers @1440x760: rail is a scroll container and reaches its last group, page unmoved",
           rail and rail["canScroll"] and rail["lastVisible"] and rail["scrollY"] == 0 and rail["railBottom"] <= rail["vh"] + 1, str(rail))
        fpage.screenshot(path=f"{OUT}/02-find-offers-rail-1440.png")

        # ---------- Business context: Find creators rail, campaign rail, app rail ----------
        bctx = browser.new_context(viewport={"width": 1440, "height": 760}, **CTXOPTS)
        login(bctx, "saltline@qa140.dev")
        bpage = bctx.new_page()
        bpage.goto(BASE + "/", wait_until="networkidle")
        bpage.wait_for_selector(".hl137-num", timeout=15000)
        # app nav rail: last item reachable by its own scroll
        # The v3 desktop rail's scroll container is .tab-main
        # (destinations + Sign out); the legacy #rail nav is
        # display:none under body.v3-on.
        navrail = bpage.evaluate("""() => { const r = document.querySelector('.tab-main');
          if (!r) return null; r.scrollTop = r.scrollHeight;
          const kids = [...r.querySelectorAll('*')].filter(e => e.getBoundingClientRect().height > 0);
          const last = kids[kids.length - 1];
          if (!last) return { empty: true, html: r.innerHTML.slice(0, 160) };
          const rr = r.getBoundingClientRect(); const lr = last.getBoundingClientRect();
          return { canScroll: r.scrollHeight > r.clientHeight + 1, scrollY: window.scrollY,
                   lastVisible: lr.bottom <= rr.bottom + 2 && lr.top >= rr.top - 2, lastCls: String(last.className) }; }""")
        ck("A app nav rail (.tab-main): last destination reachable by rail scroll alone", bool(navrail) and navrail.get("lastVisible") and navrail.get("scrollY") == 0, str(navrail))
        bpage.evaluate("go('dashboard','Discover')")
        bpage.wait_for_selector("#disc-rail", timeout=15000)
        bpage.wait_for_selector(".shelf-tile", timeout=15000)
        bpage.wait_for_timeout(500)
        wait_fit(bpage, "#disc-rail")
        rail = bpage.evaluate(RAIL_JS, "#disc-rail")
        ck("A Find creators @1440x760: rail scrolls independently to its last group",
           rail and rail["canScroll"] and rail["lastVisible"] and rail["scrollY"] == 0 and rail["railBottom"] <= rail["vh"] + 1, str(rail))
        bpage.screenshot(path=f"{OUT}/03-find-creators-rail-1440.png")
        # campaign rail
        bpage.evaluate("go('dashboard','Campaign Setup')")
        bpage.wait_for_selector(".camp-rail", timeout=15000)
        bpage.wait_for_timeout(500)
        wait_fit(bpage, ".camp-rail")
        rail = bpage.evaluate(RAIL_JS, ".camp-rail")
        if not (rail and rail["lastVisible"]):
            campdbg = bpage.evaluate("""() => { const r = document.querySelector('.camp-rail');
              const picks = [...r.querySelectorAll('.camp-pick')].filter(g => g.getBoundingClientRect().height > 0);
              const last = picks[picks.length - 1]; const rr = r.getBoundingClientRect(); const lr = last.getBoundingClientRect();
              return { nPicks: picks.length, lastText: last.innerText.slice(0, 40), lastTop: Math.round(lr.top), lastBottom: Math.round(lr.bottom),
                       lastH: Math.round(lr.height), railTop: Math.round(rr.top), railBottom: Math.round(rr.bottom),
                       scrollTop: r.scrollTop, scrollH: r.scrollHeight, clientH: r.clientHeight }; }""")
            print("  campaign rail debug:", campdbg)
        ck("A campaign rail: fitted, box inside viewport, last group reachable, page unmoved",
           rail and rail["railBottom"] <= rail["vh"] + 1 and rail["lastVisible"] and rail["scrollY"] == 0, str(rail))
        # Evidence shot: the fitted rail's own box, captured as an
        # element screenshot with the rail scrolled to its end.
        # Settle first: the async Sig brief re-renders this page
        # once when it lands (drafted-campaign card), replacing
        # the rail node; shooting before it lands races that swap.
        bpage.wait_for_timeout(2000)
        wait_fit(bpage, ".camp-rail")
        bpage.evaluate("const r = document.querySelector('.camp-rail'); if (r) r.scrollTop = r.scrollHeight;")
        bpage.wait_for_timeout(250)
        camp_el = bpage.query_selector(".camp-rail")
        if camp_el: camp_el.screenshot(path=f"{OUT}/04-campaign-rail-1440.png")

        # shelf: square logo tile sanity (Sara) — media box fixed 4/3 like the others
        bpage.evaluate("go('dashboard','Discover')")
        bpage.wait_for_selector(".shelf-tile", timeout=15000)
        shelf = bpage.evaluate("""() => { const out = {};
          for (const t of document.querySelectorAll('.shelf-tile')) {
            const ph = t.querySelector('.shelf-photo'); if (ph) out[t.innerText.split('\\n')[0]] = Math.round(ph.getBoundingClientRect().height);
          } return out; }""")
        hs = list(shelf.values())
        ck("D shelf media heights stay equal incl. square + wide logos", len(hs) >= 4 and max(hs) - min(hs) <= 2, str(shelf))

        # ---------- PDP: Kesha (legacy state) — Items B, C, D, E, F ----------
        bpage.evaluate("openCreatorProfile('crkesha')")
        bpage.wait_for_selector(".pdp-hero", timeout=10000)
        bpage.wait_for_timeout(400)
        hero = bpage.inner_text(".pdp-hero")
        ck("E-math Kesha: hero 82% and 22,960 PLAIN neighbors (no estimate label)",
           "82%" in hero and "22,960" in hero and "neighbors" in hero and "potential" not in hero, hero[:220])
        ck("E Kesha: basis small print under the hero %", "worked out from Instagram, Facebook and YouTube" in hero, hero[:260])
        pills = bpage.evaluate("[...document.querySelectorAll('.cc-plat')].map(e => e.innerText)")
        ck("F Kesha: exactly one pill (Instagram) — the current one-pill state", len(pills) == 1 and pills[0].startswith("Instagram"), str(pills))
        body = bpage.inner_text("#tab-body")
        ck("E Kesha: 'Top audience cities' line is GONE from the numbers block", "Top audience cities" not in body)
        geo = bpage.evaluate("""() => { const blocks = [...document.querySelectorAll('.pdp-block')];
          const g = blocks.find(b => b.querySelector('h4') && b.querySelector('h4').innerText.includes('Where their audience lives'));
          if (!g) return null; return { text: g.innerText, rows: [...g.querySelectorAll('.pdp-spec')].map(r => r.innerText) }; }""")
        ck("E Kesha: geography section renders (home-only state)",
           geo and any("Nashville (home market)" in r and "82%" in r for r in geo["rows"]) and "city-by-city split" in geo["text"], str(geo)[:300])
        # Item B: similar at the very bottom, below the buy box, with divider
        order = bpage.evaluate("""() => { const buy = document.querySelector('#pdp-buy'); const sim = document.querySelector('.pdp-similar-bottom');
          if (!buy || !sim) return null; const cs = getComputedStyle(sim);
          return { simAfterBuy: sim.getBoundingClientRect().top + window.scrollY > buy.getBoundingClientRect().top + window.scrollY,
                   borderTop: cs.borderTopWidth, isLast: sim === [...document.querySelectorAll('#tab-body .pdp-block')].pop() ||
                     sim.compareDocumentPosition(document.querySelector('#tab-body .panel')) !== 0 }; }""")
        ck("B Similar sits below the booking box with a divider line",
           order and order["simAfterBuy"] and order["borderTop"] == "1px", str(order))
        lastblock = bpage.evaluate("""() => { const sim = document.querySelector('.pdp-similar-bottom');
          const panel = sim.closest('.panel'); const kids = [...panel.children].filter(el => el.offsetParent !== null || el.classList.contains('pdp-similar-bottom'));
          return kids[kids.length - 1] === sim || sim.getBoundingClientRect().bottom >= Math.max(...[...panel.querySelectorAll(':scope > *')].map(e => e.getBoundingClientRect().bottom)) - 4; }""")
        ck("B Similar is the last content block on the profile", bool(lastblock), str(lastblock))
        # Item D: sim cards — Pete (photo), Ned (initial), Lena (wide logo)
        sim = bpage.evaluate("""() => { const cards = [...document.querySelectorAll('.pdp-sim')];
          return cards.map(c => { const m = c.querySelector('.pdp-sim-img');
            return { name: (c.querySelector('.pdp-sim-name') || {}).innerText || '', tag: m ? m.tagName : 'none',
                     h: m ? Math.round(m.getBoundingClientRect().height) : 0,
                     fit: m ? getComputedStyle(m).objectFit : '', cls: m ? m.className : '' }; }); }""")
        ck("D sim rail shows photo + initial + wide-logo cards", len(sim) == 3 and [s["name"] for s in sim] == ["Pete Photo", "Ned None", "Lena Logo"], str(sim))
        if len(sim) == 3:
            ck("D sim media heights equal across photo / initial / logo", max(s["h"] for s in sim) - min(s["h"] for s in sim) <= 2, str(sim))
            ck("D wide logo (2.0 aspect) is CONTAINED in the sim rail", sim[2]["fit"] == "contain" and "media-contain" in sim[2]["cls"], str(sim[2]))
            ck("D portrait photo keeps cover in the sim rail", sim[0]["fit"] == "cover", str(sim[0]))
        sim_el = bpage.query_selector(".pdp-similar-bottom")
        if sim_el: sim_el.screenshot(path=f"{OUT}/05-sim-cards.png")
        # Item C: buy box
        buybox = bpage.evaluate("""() => { const box = document.querySelector('#pdp-buy'); const btn = document.querySelector('.pdp-send');
          const det = document.querySelector('.pdp-propose'); const sum = det.querySelector('summary');
          const cs = getComputedStyle(sum); const cd = getComputedStyle(det);
          return { boxW: Math.round(box.getBoundingClientRect().width), btnW: Math.round(btn.getBoundingClientRect().width),
                   active: document.activeElement.tagName, sumOutline: cs.outlineStyle, sumOutlineW: cs.outlineWidth,
                   detBorder: [cd.borderLeftWidth, cd.borderRightWidth, cd.borderBottomWidth].join('/') }; }""")
        ck("C Send offer takes a natural width, not the full box", buybox and buybox["btnW"] > 90 and buybox["boxW"] - buybox["btnW"] > 60, str(buybox))
        ck("C Propose row at rest: no blue outline / no box border (focus-state artifact only)",
           buybox and buybox["active"] == "BODY" and buybox["sumOutline"] == "none" and buybox["detBorder"] == "0px/0px/0px", str(buybox))
        bb_el = bpage.query_selector("#pdp-buy")
        if bb_el: bb_el.screenshot(path=f"{OUT}/06-buy-box.png")
        bpage.screenshot(path=f"{OUT}/07-pdp-kesha-full.png", full_page=True)

        # ---------- PDP: Max — Item E math states 1 and 2 ----------
        bpage.evaluate("openCreatorProfile('crmax')")
        bpage.wait_for_selector(".pdp-hero", timeout=10000)
        hero = bpage.inner_text(".pdp-hero")
        ck("E-math state 1: IG 10k@82 + TikTok 40k unrated = 82% and 41,000 POTENTIAL neighbors",
           "82%" in hero and "41,000" in hero and "potential neighbors" in hero, hero[:240])
        hero_el = bpage.query_selector(".pdp-hero")
        if hero_el: hero_el.screenshot(path=f"{OUT}/08-hero-potential.png")
        # Max adds TikTok's own rate (10%) through the real profile save
        mctx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(mctx, "max@qa140.dev")
        mp = mctx.request.patch(BASE + "/api/me/profile", data={"platformLocalPct": {"instagram": 82, "tiktok": 10}},
                                headers={"Content-Type": "application/json"})
        ck("E-math: Max's TikTok-rate save accepted", mp.ok, str(mp.status))
        # Reload so the business session refetches creators (the
        # in-page Discover list is cached from before the PATCH).
        bpage.reload(wait_until="networkidle")
        bpage.evaluate("go('dashboard','Discover')")
        bpage.wait_for_selector(".shelf-tile", timeout=15000)
        bpage.wait_for_timeout(500)
        bpage.evaluate("openCreatorProfile('crmax')")
        bpage.wait_for_selector(".pdp-hero", timeout=10000)
        bpage.wait_for_timeout(400)
        hero = bpage.inner_text(".pdp-hero")
        ck("E-math state 2: after TikTok @10%, count = 12,200 PLAIN neighbors, % still 82",
           "82%" in hero and "12,200" in hero and "potential" not in hero, hero[:240])
        if hero_el: bpage.query_selector(".pdp-hero").screenshot(path=f"{OUT}/09-hero-allreal.png")

        # ---------- PDP: Gia — Item E section (multi-market) ----------
        bpage.evaluate("go('dashboard','Discover')")
        bpage.wait_for_selector(".shelf-tile", timeout=15000)
        bpage.evaluate("openCreatorProfile('crgia')")
        bpage.wait_for_selector(".pdp-hero", timeout=10000)
        geo = bpage.evaluate("""() => { const blocks = [...document.querySelectorAll('.pdp-block')];
          const g = blocks.find(b => b.querySelector('h4') && b.querySelector('h4').innerText.includes('Where their audience lives'));
          if (!g) return null;
          const strongs = [...g.querySelectorAll('.pdp-spec strong')].map(s => Math.round(s.getBoundingClientRect().right));
          return { text: g.innerText, rows: [...g.querySelectorAll('.pdp-spec')].map(r => r.innerText), rights: strongs }; }""")
        ck("E Gia: source line names the counted platforms", geo and "platforms where location is counted" in geo["text"], str(geo)[:200])
        # The app's canonical name for the Hampton Roads market is
        # "Virginia Beach" (markets.js MARKET_NAME_ALIASES) — the
        # home row must carry the canonical market name.
        ck("E Gia: home metro first with its total %", geo and geo["rows"] and "Virginia Beach (home market)" in geo["rows"][0] and "60%" in geo["rows"][0], str(geo["rows"] if geo else None))
        ck("E Gia: other metros one line each, high to low", geo and any("Nashville" in r and "12%" in r for r in geo["rows"]) and any("Austin" in r and "7%" in r for r in geo["rows"]), str(geo["rows"] if geo else None))
        ck("E Gia: complete breakdown — Everywhere else 21%", geo and any("Everywhere else" in r and "21%" in r for r in geo["rows"]), str(geo["rows"] if geo else None))
        ck("E Gia: percentages share one right-aligned column", geo and max(geo["rights"]) - min(geo["rights"]) <= 2, str(geo["rights"] if geo else None))
        ck("E Gia: city note present, no invented city split", geo and "city-by-city split for Virginia Beach" in geo["text"] and "Norfolk" not in " ".join(geo["rows"]) and "Chesapeake" not in " ".join(geo["rows"]), str(geo)[:240])
        geo_el = bpage.query_selector_all(".pdp-block")
        for el in geo_el:
            if "Where their audience lives" in el.inner_text():
                el.screenshot(path=f"{OUT}/10-geo-section.png"); break
        ck("E Gia PDP: no horizontal overflow", not overflow(bpage))

        # ---------- PDP: Pam — Item F pills + links ----------
        bpage.evaluate("openCreatorProfile('crpam')")
        bpage.wait_for_selector(".pdp-hero", timeout=10000)
        pills = bpage.evaluate("[...document.querySelectorAll('.cc-plat')].map(e => e.innerText)")
        ck("F Pam: pills = link+count platforms only, biggest first (Reddit count-only excluded)",
           len(pills) == 6 and pills[0].startswith("TikTok") and pills[1].startswith("Instagram") and pills[2].startswith("YouTube")
           and pills[3].startswith("Facebook") and pills[4].startswith("Twitch") and pills[5].startswith("Pinterest")
           and not any("Reddit" in x for x in pills), str(pills))
        links = bpage.evaluate("""() => [...document.querySelectorAll('.pdp-links a')].map(a => a.getAttribute('href'))""")
        ck("F Pam: channels list carries real hrefs for all 6 linked platforms",
           len(links) == 6 and any("twitch.tv" in h for h in links) and any("pinterest.com" in h for h in links)
           and any("tiktok.com" in h for h in links) and any("youtube.com" in h for h in links), str(links))
        pbody = bpage.inner_text("#tab-body")
        ck("F Pam: total audience is the full stack (91,500)", "91,500" in pbody, "")
        pam_el = bpage.query_selector(".creator-card.full")
        if pam_el: pam_el.screenshot(path=f"{OUT}/11-pam-hero-pills.png")

        # ---------- Creator: Fred — Sig chip, setup (Item F picker + Item E fields/award) ----------
        cctx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(cctx, "fred@qa140.dev")
        cpage = cctx.new_page()
        cpage.goto(BASE + "/", wait_until="networkidle")
        cpage.wait_for_selector("#sigtop-nudges", timeout=15000)
        cpage.wait_for_timeout(1200)
        nudges = cpage.inner_text("#sigtop-nudges")
        ck("E Sig: incomplete creator's home prompt names the missing piece + why + points",
           "under-counted" in nudges and "Instagram" in nudges and "+10 Momentum" in nudges, nudges[:260])
        cpage.screenshot(path=f"{OUT}/12-sig-home-chip.png")
        cpage.evaluate("go('dashboard','Profile')")
        cpage.wait_for_selector("#p-lp-rows", timeout=15000)
        setup = cpage.inner_text("#pf-audience")
        ck("E setup: local-% block carries the basis + why + points in plain words",
           "worked out from Instagram, Facebook and YouTube" in setup and "under-counted" in setup and "+10 Momentum" in setup, setup[:200])
        ck("F setup: platform picker offers the long tail (Twitch/Pinterest/Substack/Website)",
           cpage.evaluate("""() => [...document.querySelectorAll('#p-add-platform option')].map(o => o.value)""") != []
           and all(x in cpage.evaluate("[...document.querySelectorAll('#p-add-platform option')].map(o => o.value)") for x in ["twitch", "pinterest", "substack", "website"]),
           str(cpage.evaluate("[...document.querySelectorAll('#p-add-platform option')].map(o => o.value)")))
        cpage.select_option("#p-add-platform", "twitch")
        cpage.click("text=Add platform")
        cpage.wait_for_timeout(300)
        added = cpage.evaluate("""() => ({ stack: !!document.getElementById('p-stack-twitch'),
          link: !!document.querySelector('[data-plink="twitch"]'), lp: !!document.getElementById('p-lp-twitch') })""")
        ck("F setup: picker adds count + link + local-% rows for Twitch in one tap", added == {"stack": True, "link": True, "lp": True}, str(added))
        cpage.fill("#p-stack-twitch", "1500")
        cpage.fill("#p-lp-instagram", "82")
        cpage.screenshot(path=f"{OUT}/13-setup-platforms.png")
        cpage.click(".save-bar button[type='submit']")
        try:
            cpage.wait_for_function("document.body.innerText.includes('+10 Momentum') && document.body.innerText.includes('audience breakdown complete')", timeout=10000)
            toast_ok = True
        except Exception:
            toast_ok = False
        ck("E setup save: the +10 Momentum award shows as it lands", toast_ok, cpage.inner_text("body")[:200])
        saved = cpage.evaluate("state.user.creator")
        ck("F setup save: Twitch count stacked into the record", (saved.get("audienceStack") or {}).get("twitch") == 1500, str(saved.get("audienceStack")))
        ck("E setup save: headline % became the confirmed rate (82)", saved.get("localAudiencePct") == 82, str(saved.get("localAudiencePct")))

        # ---------- Mobile 390: Hank's quiet geography (own preview) + Find offers sheet ----------
        hctx = browser.new_context(viewport={"width": 390, "height": 844}, **CTXOPTS)
        login(hctx, "hank@qa140.dev")
        hpage = hctx.new_page()
        hpage.goto(BASE + "/", wait_until="networkidle")
        hpage.evaluate("go('dashboard','Profile')")
        hpage.wait_for_selector("#profile-peek-sw", timeout=15000)
        hpage.click("#profile-peek-sw")
        hpage.wait_for_selector(".pdp-hero", timeout=10000)
        hgeo = hpage.evaluate("""() => { const blocks = [...document.querySelectorAll('.pdp-block')];
          const g = blocks.find(b => b.querySelector('h4') && b.querySelector('h4').innerText.includes('Where their audience lives'));
          return g ? { rows: [...g.querySelectorAll('.pdp-spec')].map(r => r.innerText), text: g.innerText } : null; }""")
        ck("E Hank @390 (own preview): home-only creator shows home block + note, no other metros",
           hgeo and any("Virginia Beach (home market)" in r and "55%" in r for r in hgeo["rows"])
           and "city-by-city split" in hgeo["text"] and not any("Nashville" in r or "Austin" in r for r in hgeo["rows"]), str(hgeo)[:260])
        ck("E Hank @390: no horizontal overflow", not overflow(hpage))
        hpage.screenshot(path=f"{OUT}/14-geo-390.png", full_page=True)

        tpage = fpage  # reuse tester context at mobile size
        fpage.set_viewport_size({"width": 390, "height": 844})
        fpage.goto(BASE + "/", wait_until="networkidle")
        fpage.evaluate("go('dashboard','Find Offers')")
        fpage.wait_for_selector(".mirror-card", timeout=15000)
        ck("A 390 Find offers: no category chip row (Filters sheet pattern unchanged)", fpage.query_selector(".shop-chiprow") is None)
        fpage.click("#fo-rail-btn")
        fpage.wait_for_selector("#fo-rail.open", timeout=8000)
        ck("A 390 Find offers: sheet still carries the Category group", "category" in fpage.evaluate("document.querySelector('#fo-rail').textContent").lower())
        fpage.screenshot(path=f"{OUT}/15-find-offers-390-sheet.png")

        browser.close()
finally:
    server.kill()
print(f"\nQA build140: {len(fails)} failures" + (": " + " | ".join(fails) if fails else ""))
sys.exit(1 if fails else 0)
