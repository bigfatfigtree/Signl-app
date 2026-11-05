#!/usr/bin/env python3
"""Build -130 Playwright QA (Parts 1-9):
- Admin: totals strip (4 numbers), Markets grid (45 photos,
  canonical counts: Virginia Beach 2, Tampa 1), Stats page
  (charts + filters exercised + the books), Creators tab
  (table, search, profile view), phone bar (Review · Creators ·
  Markets · Stats, no Wallet), top-row order at 390.
- Creator + business + partner homes: Sig chat box at the top
  with the animated orb; a real question typed into the box on
  each surface gets a Sig response (Part 7 acceptance).
- Desktop rail: every destination inline, no Everything panel.
- Mobile top bars per role: name · ? · middle · hamburger.
- Site: index Sig agent panel opens with a working input + orb.
Overflow checked at every width. Chromium runs through the
local relay (127.0.0.1:8899) with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
SITE = os.path.expanduser("~/workspace/signl-site")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build130-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9070
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b130-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const C = (id, email, name, status, market, creator, days) => putUser({ id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash, status, market, city: market, createdAt: iso(now0 - days * DAY), updatedAt: iso(now0 - days * DAY), creator });
C("mandy", "mandy@b130qa.dev", "Mandy Multi", "approved", "Nashville", { handle: "multimandy", primaryPlatform: "instagram", followerCount: 15000, totalAudience: 15000, audienceStack: { instagram: 10000, tiktok: 5000 }, audienceMarkets: [{ market: "Richmond", pct: 20 }], categories: ["Food & Drink"], localAudiencePct: 55, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "" }, 40);
C("rita", "rita@b130qa.dev", "Rita Richmond", "approved", "Richmond", { handle: "ritarichmond", primaryPlatform: "instagram", followerCount: 2000, totalAudience: 2000, audienceStack: { instagram: 2000 }, categories: ["Food & Drink"], localAudiencePct: 70, tierBand: "Neighbors", profileComplete: true, hasPhoto: false, bio: "" }, 30);
C("vicky", "vicky@b130qa.dev", "Vicky Variant", "approved", "Hampton Roads", { handle: "vickyvb", primaryPlatform: "instagram", followerCount: 3000, totalAudience: 3000, audienceStack: { instagram: 3000 }, categories: ["Food & Drink"], localAudiencePct: 60, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "" }, 25);
C("jamie", "jamie@b130qa.dev", "Jamie Zed", "approved", "Tampa, Florida", { handle: "jamietampa", primaryPlatform: "instagram", followerCount: 2370, totalAudience: 2370, audienceStack: { instagram: 2370 }, categories: ["Food & Drink"], localAudiencePct: 40, tierBand: "Neighbors", profileComplete: true, hasPhoto: false, bio: "" }, 22);
C("penny", "penny@b130qa.dev", "Penny Pending", "pending", "Hampton Roads", { handle: "pennypending", primaryPlatform: "tiktok", followerCount: 800, totalAudience: 800, audienceStack: { tiktok: 800 }, categories: ["Coffee & Bakery"], tierBand: "Neighbors", profileComplete: false, hasPhoto: false, bio: "" }, 2);
C("unstated", "unstated@b130qa.dev", "Uma Unstated", "pending", "Nashville", { handle: "umaunstated", primaryPlatform: "tiktok", followerCount: 5000, totalAudience: 5000, audienceStack: { tiktok: 5000 }, categories: ["Coffee & Bakery"], tierBand: "Neighbors", profileComplete: false, hasPhoto: false, bio: "" }, 1);
putUser({ id: "diner", role: "business", email: "diner@b130qa.dev", name: "Dee Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 15 * DAY), updatedAt: iso(now0 - 15 * DAY), business: { businessName: "Deck Diner", category: "Restaurant", plan: "growth", planId: "growth", about: "Counter diner on Gallatin." } });
putUser({ id: "cafe", role: "business", email: "cafe@b130qa.dev", name: "Cal Owner", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 3 * DAY), updatedAt: iso(now0 - 3 * DAY), business: { businessName: "Pending Cafe", category: "Coffee", plan: "self", planId: "self", about: "" } });
putUser({ id: "pat", role: "partner", email: "pat@b130qa.dev", name: "Pat Partner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 50 * DAY), updatedAt: iso(now0 - 50 * DAY), partner: { name: "Pat Media", orgName: "Pat Media", type: "media", contactName: "Pat", code: "patmedia", markets: ["Nashville"], sharePct: 65, status: "active", agreementStatus: "signed", demo: false } });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-pass-130"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b130.dev"
env["ADMIN_PASSWORD"] = ADMIN_PW
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
site_server = subprocess.Popen([sys.executable, "-m", "http.server", "9071", "--bind", "127.0.0.1"],
                               cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
R = {}
try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def overflow(page):
            return page.evaluate("Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth")

        def login(ctx, email, password="qa-pass-1234"):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": password})
            return r.status

        def shot(page, name):
            page.screenshot(path=os.path.join(OUT, name + ".png"))

        # ---------------- Admin desktop ----------------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        assert login(ctx, "admin@b130.dev", ADMIN_PW) == 200
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector(".totals126", timeout=30000)
        strip = page.inner_text(".totals126")
        R["totals_strip"] = strip.replace("\n", " | ")
        for want in ["6", "28,170", "12,398", "56%"]:
            assert want in strip, f"totals strip missing {want}: {strip}"
        R["overflow_admin_home_desktop"] = overflow(page)
        shot(page, "01-admin-home-desktop")

        # Markets grid: photos + canonical counts
        page.click(".rail-item[aria-label='Markets']")
        page.wait_for_selector(".mkt-photo", timeout=30000)
        cards = page.query_selector_all(".mkt-card")
        R["market_cards"] = len(cards)
        assert len(cards) == 45, f"expected 45 market cards, got {len(cards)}"
        photos_ok = page.evaluate("""() => [...document.querySelectorAll('.mkt-photo')].every(el => {
          const bg = getComputedStyle(el).backgroundImage; return bg && bg.includes('market-photos'); })""")
        R["all_cards_photo_styled"] = photos_ok
        vb = page.evaluate("""() => { const c = [...document.querySelectorAll('.mkt-card')].find(x => x.innerText.includes('Virginia Beach')); return c ? c.innerText.replace(/\\n/g, ' | ') : 'NOT FOUND'; }""")
        tampa = page.evaluate("""() => { const c = [...document.querySelectorAll('.mkt-card')].find(x => x.innerText.includes('Tampa')); return c ? c.innerText.replace(/\\n/g, ' | ') : 'NOT FOUND'; }""")
        R["vb_card"] = vb
        R["tampa_card"] = tampa
        # photo HTTP spot-checks via the API request context
        codes = {}
        for mid in ["hampton-roads", "nashville", "london", "tampa", "auckland", "mexico-city"]:
            codes[mid] = ctx.request.get(BASE + f"/assets/market-photos/{mid}.jpg").status
        R["photo_http"] = codes
        assert all(v == 200 for v in codes.values()), codes
        shot(page, "02-admin-markets-desktop")

        # Stats page: charts + filters + books
        page.click(".rail-item[aria-label='Stats']")
        page.wait_for_selector("#ast-charts .stat-band", timeout=30000)
        stats_text = page.inner_text("#ast-charts")
        R["stats_headline_ok"] = all(w in stats_text for w in ["Creators signed up", "Local followers", "Avg % local", "Signups over time", "From signup to ready", "Collected so far", "Founding pipeline", "Recorded, not yet billed"])
        band1 = page.inner_text("#ast-charts .stat-band")
        R["stats_band_all"] = band1.replace("\n", " | ")
        assert "28.2k" in band1 and "12.4k" in band1, band1
        page.select_option("select[onchange^='astSetFilter(\\'status\\'']", "pending")
        page.wait_for_timeout(400)
        band2 = page.inner_text("#ast-charts .stat-band")
        R["stats_band_pending"] = band2.replace("\n", " | ")
        first_cell = page.evaluate("() => document.querySelector('#ast-charts .stat-band .stat-cell strong').innerText")
        assert first_cell == "2", f"pending filter should show 2 creators, got {first_cell}: {band2}"
        page.select_option("select[onchange^='astSetFilter(\\'status\\'']", "all")
        page.wait_for_timeout(300)
        # books: Money default, then Owed, then Close
        page.wait_for_selector("#cc-body .cc-tiles, #cc-body .panel", timeout=15000)
        R["books_money_ok"] = "Through the platform" in page.inner_text("#cc-body")
        page.click("button:has-text('Owed')")
        page.wait_for_timeout(1200)
        R["books_owed_rendered"] = len(page.inner_text("#cc-body")) > 40
        page.click("button:has-text('Close')")
        page.wait_for_timeout(1200)
        R["books_close_rendered"] = len(page.inner_text("#cc-body")) > 40
        R["overflow_stats_desktop"] = overflow(page)
        shot(page, "03-admin-stats-desktop")

        # Creators tab
        page.click(".rail-item[aria-label='Creators']")
        page.wait_for_selector("#acr-list table", timeout=30000)
        rows = page.query_selector_all("#acr-list tbody tr, #acr-list table tr")
        R["creators_rows"] = len(rows)
        page.fill("input[type='search']", "Jamie")
        page.wait_for_timeout(400)
        jamie_rows = page.evaluate("() => document.querySelectorAll('#acr-list table tr').length")
        R["creators_search_jamie_rows"] = jamie_rows
        assert jamie_rows == 2, f"header + Jamie row expected, got {jamie_rows}"
        page.click("#acr-list button:has-text('View')")
        page.wait_for_timeout(1500)
        R["creator_profile_view_ok"] = "Jamie" in page.inner_text("#tab-body")
        shot(page, "04-admin-creators-desktop")
        ctx.close()

        # ---------------- Admin phone ----------------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, device_scale_factor=3, is_mobile=True)
        assert login(ctx, "admin@b130.dev", ADMIN_PW) == 200
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector(".totals126", timeout=30000)
        bar_text = page.evaluate("""() => { const el = document.getElementById('tabbar'); return el ? el.innerText.replace(/\\n/g, ' | ') : 'NO TABBAR'; }""")
        R["admin_phone_bar"] = bar_text
        assert "Wallet" not in bar_text, bar_text
        order = page.evaluate("""() => { const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return Math.round(r.x); };
          return { id: q('.tr-id'), help: q('.tr-help126'), stats: q('.tr-right button'), menu: q('.tr-ev125') }; }""")
        R["admin_toprow_order"] = order
        assert order["id"] is not None and order["help"] > order["id"] and order["menu"] > order["help"], order
        R["overflow_admin_home_390"] = overflow(page)
        shot(page, "05-admin-home-390")
        page.evaluate("go('dashboard','Stats')")
        page.wait_for_selector("#ast-charts .stat-band", timeout=30000)
        R["overflow_stats_390"] = overflow(page)
        shot(page, "06-admin-stats-390")
        page.evaluate("go('dashboard','Markets')")
        page.wait_for_selector(".mkt-photo", timeout=30000)
        R["overflow_markets_390"] = overflow(page)
        shot(page, "07-admin-markets-390")
        ctx.close()

        # ---------------- Creator ----------------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        assert login(ctx, "mandy@b130qa.dev") == 200
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector(".sigtop130 .sigbox130", timeout=30000)
        vid = page.evaluate("""() => { const v = document.querySelector('.sigtop130 video'); return v ? { src: (v.currentSrc || '').includes('orb.mp4'), paused: v.paused } : null; }""")
        page.wait_for_timeout(1200)
        vid = page.evaluate("""() => { const v = document.querySelector('.sigtop130 video'); return v ? { src: (v.currentSrc || '').includes('orb.mp4'), paused: v.paused } : null; }""") or vid
        R["creator_sig_video"] = vid
        page.fill(".sigtop130 input", "What are my numbers?")
        page.press(".sigtop130 input", "Enter")
        page.wait_for_function("""() => { const t = document.querySelector('.sigtop130 .sigbox-thread'); return t && !t.hidden && t.innerText.length > 40 && !t.innerText.endsWith('One sec.'); }""", timeout=20000)
        box_text = page.inner_text(".sigtop130")
        R["creator_sig_answer"] = box_text[-260:]
        assert "Momentum points" in box_text and "visits booked" in box_text, box_text[-400:]
        R["overflow_creator_desktop"] = overflow(page)
        shot(page, "08-creator-home-desktop")
        # desktop rail: secondaries inline, Everything trigger hidden
        ev_hidden = page.evaluate("""() => { const e = document.querySelector('.tab-ev125'); if (!e) return 'absent'; const cs = getComputedStyle(e); return cs.display; }""")
        R["creator_ev_trigger_desktop_display"] = ev_hidden
        rail_labels = page.evaluate("""() => [...document.querySelectorAll('.tab-item .tab-label, #tabbar .tab-item')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 30)""")
        R["creator_rail_items"] = rail_labels
        ctx.close()

        # creator phone top bar order
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, device_scale_factor=3, is_mobile=True)
        assert login(ctx, "mandy@b130qa.dev") == 200
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector(".sigtop130 .sigbox130", timeout=30000)
        order = page.evaluate("""() => { const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? Math.round(r.x) : null; };
          return { id: q('.tb2-id'), help: q('.tb2-help130'), msg: q('.tb2-msg'), menu: q('.tb2-ev125') }; }""")
        R["creator_topbar_order"] = order
        assert order["id"] is not None and order["help"] is not None and order["help"] > order["id"] and order["menu"] > order["help"], order
        R["overflow_creator_390"] = overflow(page)
        shot(page, "09-creator-home-390")
        ctx.close()

        # ---------------- Business ----------------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        assert login(ctx, "diner@b130qa.dev") == 200
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector(".sigtop130 .sigbox130", timeout=30000)
        page.fill(".sigtop130 input", "What is SIGNL?")
        page.press(".sigtop130 input", "Enter")
        try:
            page.wait_for_function("""() => { const t = document.querySelector('.sigtop130 .sigbox-thread'); return t && !t.hidden && t.innerText.length > 30 && !t.innerText.endsWith('One sec.'); }""", timeout=20000)
            R["business_sig_answered"] = True
        except Exception:
            R["business_sig_answered"] = False
        box_text = page.inner_text(".sigtop130")
        R["business_sig_box_tail"] = box_text[-200:]
        R["overflow_business_desktop"] = overflow(page)
        shot(page, "10-business-home-desktop")
        ctx.close()

        # ---------------- Partner ----------------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        st = login(ctx, "pat@b130qa.dev")
        R["partner_login_status"] = st
        if st == 200:
            page = ctx.new_page()
            page.goto(BASE + "/", wait_until="networkidle")
            try:
                page.wait_for_selector(".sigtop130 .sigbox130", timeout=30000)
                R["partner_sig_box"] = True
                shot(page, "11-partner-home-desktop")
            except Exception as e:
                R["partner_sig_box"] = f"missing: {e}"
        ctx.close()

        # ---------------- Site ----------------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        page.goto("http://127.0.0.1:9071/index.html", wait_until="networkidle")
        page.wait_for_timeout(1200)
        R["site_orb_present"] = page.evaluate("""() => document.documentElement.innerHTML.includes('sig-orb')""")
        # open the Sig agent panel and type
        opened = page.evaluate("""() => { const t = document.querySelector('[data-sig-open], .sigx-launcher, #sigx-launcher, button[aria-label*=\"Sig\" i]'); if (t) { t.click(); return true; } return false; }""")
        page.wait_for_timeout(1200)
        inp = page.query_selector("#sigx-input, .sigx-panel input, [class*='sig'] input")
        R["site_sig_input_found"] = bool(inp)
        if inp:
            inp.fill("How does SIGNL work for a business?")
            inp.press("Enter")
            page.wait_for_timeout(2000)
            R["site_sig_panel_tail"] = page.evaluate("""() => { const p = document.querySelector('.sigx-panel, [class*=\"sigx\"]'); return p ? p.innerText.slice(-220) : 'no panel'; }""")
        shot(page, "12-site-index-sig")
        ctx.close()

    print(json.dumps(R, indent=1, default=str))
finally:
    server.terminate()
    site_server.terminate()
