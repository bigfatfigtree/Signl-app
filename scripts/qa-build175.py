#!/usr/bin/env python3
"""Build -175 rendered QA: "Total local" on a production-shaped
store, desktop 1440 + phone 390.

Seeded Nashville roster (founding order Dana -> Bella -> Erin):
  Dana: 5,000 followers at 90% local = 4,500 people here
  Bella: 1,200,000 at 20% = 240,000 people here (Jeff's case)
  Erin: 400,000 IG at its own 25% + 200,000 TikTok unrated
        = 150,000 people here, part estimated ("potential")

Asserts, on the REAL rendered surfaces:
1. Shelf (default sort): Dana first (% leads), every tile's
   big count present and non-empty; Bella's tile reads
   240,000 people here / 20% local; Erin's says potential.
2. Sort "Most people here": order becomes Bella, Erin, Dana.
3. The people-here floor filters (100,000+ leaves Bella +
   Erin), composes with the 85% local floor to the honest
   filters empty state, and Clear filters restores the roster.
4. Cards (deck) mode under the people sort: the top card is
   Bella's, count big on the card.
5. See-everyone (list) mode: the count line renders per card.
6. Creator profile (PDP): the hero count renders big.
7. Admin preview twin: pvf-sort carries the option and the
   pvf-minpeople floor filters there too.
8. Phone 390: sort via the rail select, counts present.
Every <img> asserted loaded; no horizontal overflow.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app-175")
OUT = os.path.expanduser("~/workspace/research_notes/build175-qa-2026-11-09")
os.makedirs(OUT, exist_ok=True)
PORT = 9175
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-175-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = (pw) => crypto.scryptSync(pw, salt, 64).toString("hex");
const now = new Date().toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "admin1", role: "admin", email: "admin@qa.dev", name: "Jeff Rimmer", passwordSalt: salt, passwordHash: hash("qa-admin-pass"), status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: now });
const creator = (id, email, name, createdAt, creator) => putUser({ id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash("qa-creator-pass"), status: "approved", market: "Nashville", city: "Nashville", createdAt, updatedAt: now, tester: false, creator });
creator("crdana", "dana@qa.dev", "Dense Dana", "2026-10-01T00:00:00.000Z", { handle: "densedana", primaryPlatform: "instagram", instagramUrl: "https://www.instagram.com/densedana/", categories: ["Food & Drink"], compCategories: [], compOpen: true, audienceStack: { instagram: 5000 }, followerCount: 5000, totalAudience: 5000, localAudiencePct: 90, localAudienceSource: "Self-reported", platformLocalPct: {}, profileComplete: true, hasPhoto: false, paidRate: 150, bio: "Dense Dana — Nashville food, daily posts and honest local reviews." });
creator("crbella", "bella@qa.dev", "Big Bella", "2026-10-02T00:00:00.000Z", { handle: "bigbella", primaryPlatform: "instagram", instagramUrl: "https://www.instagram.com/bigbella/", categories: ["Food & Drink"], compCategories: [], compOpen: true, audienceStack: { instagram: 1200000 }, followerCount: 1200000, totalAudience: 1200000, localAudiencePct: 20, localAudienceSource: "Self-reported", platformLocalPct: {}, profileComplete: true, hasPhoto: false, paidRate: 900, bio: "Big Bella — Nashville food at national scale, honest reviews always." });
creator("crerin", "erin@qa.dev", "Extra Erin", "2026-10-03T00:00:00.000Z", { handle: "extraerin", primaryPlatform: "instagram", instagramUrl: "https://www.instagram.com/extraerin/", categories: ["Food & Drink"], compCategories: [], compOpen: true, audienceStack: { instagram: 400000, tiktok: 200000 }, followerCount: 400000, totalAudience: 600000, localAudiencePct: 25, localAudienceSource: "Self-reported", platformLocalPct: { instagram: 25 }, profileComplete: true, hasPhoto: false, paidRate: 400, bio: "Extra Erin — Nashville food on two platforms, local first, always honest." });
const biz = (id, email, name, business) => putUser({ id, role: "business", email, name, passwordSalt: salt, passwordHash: hash("qa-biz-pass"), status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: now, tester: false, business });
biz("biz1", "biz@qa.dev", "Biz Owner", { businessName: "Fixture Kitchen", category: "Food & Drink", plan: "self-service", hasPhoto: false, about: "A Nashville kitchen." });
data["config:markets"] = { flags: { "Nashville": true, "Virginia Beach": true } };
data["config:recruiterKitEmailV1Sent"] = { version: 1, claimedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z", recipients: [] };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE,
           ADMIN_EMAIL="admin@qa.dev", ADMIN_PASSWORD="<redacted>", SIGNL_TEST_ALLOW_BUSINESS="1")
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "SIG_AI_API_KEY", "SIG_AI_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MAGGIE_AI_ENABLED", "MAGGIE_AI_MODEL"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
R = {}
FAILS = []
def check(name, cond, detail=""):
    R[name] = detail if detail else ("ok" if cond else "FAIL")
    if not cond:
        FAILS.append(name)
    print(("ok - " if cond else "FAIL - ") + name + ((" :: " + str(detail)[:240]) if detail else ""))

try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def login(ctx, email, pw):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
            assert r.status == 200, f"login {email} -> {r.status}"

        def boot_page(ctx):
            page = ctx.new_page()
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
            page.wait_for_timeout(900)
            return page

        def facts(page):
            return page.evaluate("""() => {
              const imgs = [...document.images];
              return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                       imgTotal: imgs.length,
                       imgBroken: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).length };
            }""")

        def tile_names(page):
            return page.evaluate("""() => [...document.querySelectorAll('.shelf-tile .shelf-name')].map((n) => n.innerText.trim())""")

        def tile_texts(page):
            return page.evaluate("""() => [...document.querySelectorAll('.shelf-tile')].map((t) => t.innerText.replace(/\\s+/g, ' '))""")

        def counts(page):
            return page.evaluate("""() => [...document.querySelectorAll('.shelf-count')].map((n) => n.innerText.trim())""")

        def open_discover(page):
            page.evaluate("go('dashboard','Discover')")
            page.wait_for_function("() => document.querySelectorAll('.shelf-tile').length >= 3", timeout=30000)
            page.wait_for_timeout(500)

        # ---------- business, desktop ----------
        ctx = b.new_context(viewport={"width": 1440, "height": 950})
        login(ctx, "biz@qa.dev", "qa-biz-pass")
        page = boot_page(ctx)
        open_discover(page)

        names = tile_names(page)
        check("shelf default: founding/% order leads with Dense Dana (90% local)", names[:1] == ["Dense Dana"], names)
        cs = counts(page)
        check("shelf default: every tile's big count is present and non-empty", len(cs) == 3 and all(cs), cs)
        texts = tile_texts(page)
        bella = [t for t in texts if "Big Bella" in t]
        check("shelf default: Bella's tile reads 240,000 + people here + 20% local",
              len(bella) == 1 and "240,000" in bella[0] and "people here" in bella[0] and "20% local" in bella[0], bella)
        erin = [t for t in texts if "Extra Erin" in t]
        check("shelf default: Erin's tile reads 150,000 potential people here",
              len(erin) == 1 and "150,000" in erin[0] and "potential people here" in erin[0], erin)
        dana = [t for t in texts if "Dense Dana" in t]
        check("shelf default: Dana's tile reads 4,500 people here at 90% local",
              len(dana) == 1 and "4,500" in dana[0] and "90% local" in dana[0], dana)
        f = facts(page); check("shelf default: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=os.path.join(OUT, "01-shelf-default-1440.png"), full_page=True)

        # sort: Most people here
        page.select_option("#f-sort", "people")
        page.wait_for_function("() => { const n = document.querySelector('.shelf-tile .shelf-name'); return n && n.innerText.includes('Big Bella'); }", timeout=30000)
        page.wait_for_timeout(400)
        names = tile_names(page)
        check("sort people: order is Bella, Erin, Dana (count desc)", names == ["Big Bella", "Extra Erin", "Dense Dana"], names)
        page.screenshot(path=os.path.join(OUT, "02-shelf-people-sort-1440.png"), full_page=True)

        # filter: 100,000+ people here
        page.evaluate("discMinPeopleSet('100000')")
        page.wait_for_function("() => document.querySelectorAll('.shelf-tile').length === 2", timeout=30000)
        names = tile_names(page)
        check("filter 100,000+: only Bella + Erin remain", sorted(names) == ["Big Bella", "Extra Erin"], names)
        cnt = page.evaluate("() => document.getElementById('discover-count').innerText")
        check("filter 100,000+: the result count says 2", cnt.strip().startswith("2"), cnt)

        # compose with the 85% local floor -> honest filters empty state
        page.evaluate("discMinLocalSet('85')")
        page.wait_for_function("() => document.body.innerText.includes('No creators match those filters')", timeout=30000)
        body = page.evaluate("() => document.body.innerText")
        check("compose: the emptied roster shows the honest filters empty state",
              "Nobody in this market reaches that many local people yet" in body)
        page.screenshot(path=os.path.join(OUT, "03-filters-empty-1440.png"), full_page=True)
        # clear filters restores the roster
        page.evaluate("discoverClearFilters()")
        page.wait_for_function("() => document.querySelectorAll('.shelf-tile').length === 3", timeout=30000)
        check("clear filters: the full roster is back", len(tile_names(page)) == 3, tile_names(page))

        # deck mode under the people sort
        page.select_option("#f-sort", "people")
        page.wait_for_timeout(600)
        page.evaluate("setDiscoverMode('cards')")
        page.wait_for_function("() => { const c = document.querySelector('[data-stack=\"discover\"] .stk-card'); return c && c.innerText.includes('Big Bella'); }", timeout=30000)
        deck = page.evaluate("() => document.querySelector('[data-stack=\"discover\"] .stk-card').innerText.replace(/\\s+/g, ' ')")
        check("deck (people sort): top card is Bella with 240,000 people here · 20% local",
              "240,000" in deck and "PEOPLE HERE · 20% LOCAL" in deck.upper(), deck[:300])
        f = facts(page); check("deck: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=os.path.join(OUT, "04-deck-people-1440.png"), full_page=True)

        # list mode
        page.evaluate("setDiscoverMode('list')")
        page.wait_for_function("() => document.querySelectorAll('.cc-localcount').length >= 3", timeout=30000)
        lines = page.evaluate("""() => [...document.querySelectorAll('.cc-localcount')].map((n) => n.innerText.trim())""")
        check("list mode: every card's count line renders, Bella's is 240,000 people here",
              len(lines) == 3 and all(lines) and any("240,000 people here" in x for x in lines), lines)
        check("list mode: Erin's line carries the potential label",
              any("150,000 potential people here" in x for x in lines), lines)
        page.screenshot(path=os.path.join(OUT, "05-list-1440.png"), full_page=True)

        # PDP: open Bella from the shelf
        page.evaluate("setDiscoverMode('shelf')")
        page.wait_for_function("() => document.querySelectorAll('.shelf-tile').length >= 3", timeout=30000)
        page.evaluate("() => { const t = [...document.querySelectorAll('.shelf-tile')].find((x) => x.innerText.includes('Big Bella')); t.querySelector('.shelf-name').click(); }")
        page.wait_for_function("() => { const h = document.querySelector('.pdp-hero-countnum'); return h && h.innerText.trim() === '240,000'; }", timeout=30000)
        hero = page.evaluate("() => document.querySelector('.pdp-hero').innerText.replace(/\\s+/g, ' ')")
        check("PDP hero: Bella's count renders big in the neighbors sentence", "240,000" in hero and "neighbors" in hero, hero[:240])
        f = facts(page); check("PDP: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=os.path.join(OUT, "06-pdp-bella-1440.png"), full_page=True)
        ctx.close()

        # ---------- admin preview twin, desktop ----------
        ctx = b.new_context(viewport={"width": 1440, "height": 950})
        login(ctx, "admin@qa.dev", "qa-admin-pass")
        page = boot_page(ctx)
        page.evaluate("""() => {
          enterPreview();
          state.preview.market = 'Nashville';
          previewNavTo('discover');
        }""")
        page.wait_for_function("() => document.getElementById('pvf-sort') && document.getElementById('pvf-minpeople')", timeout=30000)
        opts = page.evaluate("() => [...document.getElementById('pvf-sort').options].map((o) => o.textContent)")
        check("preview twin: the sort select carries 'Most people here'", "Most people here" in opts, opts)
        page.select_option("#pvf-market", "Nashville")
        page.evaluate("() => { document.getElementById('pvf-sort').value = 'people'; }")
        page.evaluate("runPreviewDiscover()")
        page.wait_for_function("() => { const b2 = document.getElementById('pv-discover-body'); return b2 && b2.innerText.includes('Big Bella'); }", timeout=30000)
        page.wait_for_timeout(500)
        first = page.evaluate("() => { const c = document.querySelector('#pv-discover-body .stk-card'); return c ? c.innerText.replace(/\\s+/g, ' ') : ''; }")
        check("preview twin (people sort): the top deck card is Bella's with the big count",
              "Big Bella" in first and "240,000" in first, first[:240])
        page.evaluate("() => { document.getElementById('pvf-minpeople').value = '100000'; }")
        page.evaluate("runPreviewDiscover()")
        page.wait_for_timeout(900)
        body_txt = page.evaluate("() => document.getElementById('pv-results').innerText")
        check("preview twin: the 100,000+ floor keeps Bella, drops Dana",
              "Dense Dana" not in body_txt and "Big Bella" in body_txt, body_txt[:240])
        # Image rule, scoped honestly: the app's own assets must
        # load; the preview's decorative Pexels sample photos are
        # remote stock the sandbox browser cannot fetch (they are
        # pre-existing preview decoration, not app assets).
        f = facts(page)
        local_imgs = page.evaluate("""() => [...document.images].filter((i) => i.src.startsWith(location.origin)).map((i) => ({ src: i.src, ok: i.complete && i.naturalWidth > 0 }))""")
        check("preview twin: no overflow, app-asset images loaded (remote Pexels samples excluded)",
              not f["overflow"] and all(i["ok"] for i in local_imgs), local_imgs)
        page.screenshot(path=os.path.join(OUT, "07-preview-twin-1440.png"), full_page=True)
        ctx.close()

        # ---------- business, phone 390 ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "biz@qa.dev", "qa-biz-pass")
        page = boot_page(ctx)
        open_discover(page)
        cs = counts(page)
        check("phone shelf: counts present and non-empty", len(cs) == 3 and all(cs), cs)
        page.evaluate("shopRailToggle('disc-rail')")
        page.wait_for_timeout(400)
        # The closed sheet is visibility:hidden and its innerText
        # stays empty even open (off-canvas groups), so assert on
        # the open sheet's visibility + the group's real radio.
        rail_has = page.evaluate("""() => { const r = document.getElementById('disc-rail'); return r.classList.contains('open') && getComputedStyle(r).visibility === 'visible' && !!r.querySelector('input[name="disc-minpeople"][value="100000"]') && r.textContent.includes('How many people they reach here'); }""")
        check("phone rail: the people-here filter group is in the Filters sheet", rail_has)
        page.select_option("#f-sort-m", "people")
        page.wait_for_function("() => { const n = document.querySelector('.shelf-tile .shelf-name'); return n && n.innerText.includes('Big Bella'); }", timeout=30000)
        names = tile_names(page)
        check("phone sort people: Bella leads", names[:1] == ["Big Bella"], names)
        f = facts(page); check("phone: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=os.path.join(OUT, "08-shelf-people-390.png"), full_page=True)
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except Exception:
        server.kill()

print(json.dumps({"passed": len(R) - len(FAILS), "failed": len(FAILS), "failures": FAILS}, indent=1))
sys.exit(1 if FAILS else 0)
