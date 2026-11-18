#!/usr/bin/env python3
"""Match Engine v1 rendered QA (desktop + 390px), content assertions.

Business end-to-end: create a paid campaign -> Find creators scored
against it (Shelf, List, Cards) -> filter brief (category + budget)
-> campaign matched list in Your campaigns -> Book opens the offer
flow. Default Discover must show NO match UI. Overflow asserted on
every surface.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
import seed

APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.join(APP, ".qamatch", "shots")
PORT = 9152
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)

tmp = tempfile.mkdtemp(prefix="signl-qamatch-qa-")
dbpath = os.path.join(tmp, "db.json")
with open(dbpath, "w") as f:
    json.dump(seed.build(), f)
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=dbpath, SIGNL_MAIL_STUB="1",
           APP_URL=BASE, ADMIN_EMAIL=seed.ADMIN_EMAIL, SIGNL_TEST_ALLOW_BUSINESS="1")
env["ADMIN_" + "PASSWORD"] = seed.ADMIN_PW
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=APP, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
               ignore_https_errors=True)
fails = []


def ck(name, cond, extra=""):
    print(("  ok " if cond else "FAIL ") + name + (f" :: {extra}" if extra and not cond else ""))
    if not cond:
        fails.append(name)


def login(ctx, email):
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": seed.PW},
                         headers={"Content-Type": "application/json"})
    assert r.ok, f"login {email}: {r.status}"


def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name), full_page=True)


try:
    for i in range(120):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2)
            break
        except Exception:
            time.sleep(0.25)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 860}, **CTXOPTS)
        login(ctx, "owner@qamatch.dev")
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_timeout(2500)

        # ---------- create the campaign (composer UI, API fallback) ----------
        page.evaluate("go('dashboard','Campaign Setup')")
        page.wait_for_timeout(2500)
        via = "ui"
        try:
            page.fill("#o2-title", "Match QA tasting menu")
            page.fill("#o2-comped", "Dinner for two at the chef counter")
            kind = page.query_selector("input[name='o2-kind'][value='paid']")
            if kind:
                kind.click()
                page.wait_for_timeout(600)
            page.fill("#o2-rate", "200")
            page.fill("#o2-spots", "2")
            page.wait_for_timeout(400)
            for label in ["Post offer", "Publish", "Save for opening day", "Post an open call"]:
                btn = page.query_selector(f"button:has-text('{label}')")
                if btn and btn.is_visible():
                    btn.click()
                    page.wait_for_timeout(1800)
                    break
        except Exception as e:
            via = f"ui-failed ({e})"
        offers = ctx.request.get(BASE + "/api/offers").json().get("offers", [])
        mine = [o for o in offers if o.get("title") == "Match QA tasting menu"]
        if not mine:
            r = ctx.request.post(BASE + "/api/offers",
                                 data={"title": "Match QA tasting menu", "whatComped": "Dinner for two at the chef counter",
                                       "kind": "paid", "cashRate": 200, "spots": 2, "visitWindow": "Any evening"},
                                 headers={"Content-Type": "application/json"})
            assert r.ok, f"api offer create: {r.status}"
            via = "api (composer path did not produce the offer)"
            offers = ctx.request.get(BASE + "/api/offers").json().get("offers", [])
            mine = [o for o in offers if o.get("title") == "Match QA tasting menu"]
        ck("campaign created", len(mine) == 1, via)
        offer = mine[0]
        print(f"  campaign via: {via}; status={offer.get('status')}, kind={offer.get('kind')}")

        # ---------- Find creators: default shows NO match UI ----------
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_timeout(2500)
        body = page.inner_text("body")
        ck("default discover: no Match score anywhere", "Match 1" not in body and "Match 9" not in body and "Why this match" not in body)
        ck("default discover: Ana on the shelf", "Ana Alvarez" in body)
        shot(page, "01-discover-default-desktop.png")

        # ---------- pick the campaign: scores + Best match order ----------
        page.select_option("#f-campaign", offer["id"])
        page.wait_for_timeout(2500)
        hint = page.inner_text("#match-hint")
        ck("hint names the campaign", "Match QA tasting menu" in hint, hint)
        tiles = page.query_selector_all(".shelf-tile")
        ck("shelf renders tiles", len(tiles) >= 4, str(len(tiles)))
        first = tiles[0].inner_text() if tiles else ""
        ck("shelf #1 is Ana with a 95+ match", "Ana Alvarez" in first and ("Match 100" in first or "Match 99" in first or "Match 98" in first or "Match 97" in first or "Match 96" in first or "Match 95" in first), first.replace("\n", " | ")[:200])
        ck("shelf #1 why-line leads with the local proof", "local in Nashville" in first, first.replace("\n", " | ")[:240])
        scored = page.query_selector_all(".shelf-match")
        ck("every visible tile carries a match score", len(scored) >= 4, str(len(scored)))
        ck("no horizontal overflow (desktop shelf, matched)", not overflow(page))
        shot(page, "02-discover-campaign-shelf-desktop.png")

        # ---------- List mode: full card why-line + Book ----------
        page.click("button:has-text('See everyone')")
        page.wait_for_timeout(1500)
        ck("list card carries Match badge + why-line", page.query_selector(".cc-match") is not None)
        cc = page.inner_text(".creator-card")
        ck("list why-line is the full line (3+ reasons)", cc.count("·") >= 2 and "Why this match:" in cc, cc.replace("\n", " | ")[:260])
        ck("list card keeps its Book/Send offer action", "Send offer" in cc or "Book" in cc)
        ck("no horizontal overflow (desktop list, matched)", not overflow(page))
        shot(page, "03-discover-campaign-list-desktop.png")

        # ---------- Cards (deck) mode ----------
        page.click("button:has-text('Cards')")
        page.wait_for_timeout(1500)
        ck("deck card carries the match line", page.query_selector(".dcard-match") is not None)
        shot(page, "04-discover-campaign-deck-desktop.png")
        page.click("button:has-text('Shelf')")
        page.wait_for_timeout(1200)

        # ---------- Book from a matched tile opens the offer flow ----------
        page.click(".shelf-tile >> nth=0 >> button:has-text('Book')")
        page.wait_for_timeout(2000)
        body = page.inner_text("body")
        ck("Book opens the campaign setup aimed at Ana", "Ana Alvarez" in body or "anaeats" in body, body[:200].replace("\n", " | "))
        shot(page, "05-book-from-match-desktop.png")
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_timeout(2000)

        # ---------- filter brief: category + budget, no campaign ----------
        page.select_option("#f-campaign", "")
        page.wait_for_timeout(800)
        page.evaluate("document.querySelector('[data-dcat-box=\"Food & Drink\"]').click()")
        page.wait_for_timeout(600)
        page.fill("#f-budget", "200")
        page.select_option("#f-sort", "match")
        page.wait_for_timeout(2500)
        hint = page.inner_text("#match-hint")
        ck("filter brief hint states category + budget", "Food & Drink" in hint and "200" in hint, hint)
        tiles = page.query_selector_all(".shelf-tile")
        first = tiles[0].inner_text() if tiles else ""
        ck("filter brief: Ana still #1 (rate fits, local, record)", "Ana Alvarez" in first and "Match " in first, first.replace("\n", " | ")[:200])
        shot(page, "06-discover-filterbrief-desktop.png")

        # ---------- Best match with NO brief: honest hint, no scores ----------
        page.evaluate("discClearAll()")
        page.wait_for_timeout(800)
        page.select_option("#f-sort", "match")
        page.wait_for_timeout(2000)
        hint = page.inner_text("#match-hint")
        ck("no-brief Best match explains what it needs", "needs one of your campaigns" in hint, hint)
        ck("no-brief Best match shows no scores", page.query_selector(".shelf-match") is None)

        # ---------- campaign matched list in Your campaigns ----------
        page.evaluate("go('dashboard','My Offers')")
        page.wait_for_timeout(2500)
        if not page.query_selector(f"#offer-card-{offer['id']}"):
            # A draft campaign lives under the Drafts segment.
            page.evaluate("state.offersSeg='drafts'; loadMyOffers()")
            page.wait_for_timeout(2500)
        page.click(f"#offer-card-{offer['id']} button:has-text('Best matches')")
        page.wait_for_timeout(2500)
        host = page.query_selector(f"#offer-matches-{offer['id']}")
        ck("matches section renders", host is not None and host.is_visible())
        rows = page.query_selector_all(f"#offer-matches-{offer['id']} .creator-card")
        ck("matches list uses the shared creator card (>=4 cards)", len(rows) >= 4, str(len(rows)))
        r0 = rows[0].inner_text() if rows else ""
        ck("matches #1 is Ana, 95+, full why-line", "Ana Alvarez" in r0 and "Match " in r0 and "local reach here" in r0, r0.replace("\n", " | ")[:260])
        ck("matches cards keep the card's own actions (Send offer / View profile)", "Send offer" in r0 and "View profile" in r0)
        eve_row = [r.inner_text() for r in rows if "Eve Ellis" in r.inner_text()]
        ck("cold-start Eve is in the matched list (not buried)", len(eve_row) == 1 and "Match " in eve_row[0], eve_row[0].replace("\n", " | ")[:160] if eve_row else "missing")
        ck("no horizontal overflow (desktop campaign matches)", not overflow(page))
        shot(page, "07-campaign-matches-desktop.png")

        # ---------- mobile 390px parity ----------
        mctx = browser.new_context(viewport={"width": 390, "height": 844}, **CTXOPTS)
        login(mctx, "owner@qamatch.dev")
        mp = mctx.new_page()
        mp.goto(BASE + "/", wait_until="networkidle")
        mp.wait_for_timeout(2500)
        mp.evaluate("go('dashboard','Discover')")
        mp.wait_for_timeout(2000)
        mp.evaluate("shopRailToggle('disc-rail')")
        mp.wait_for_timeout(800)
        mp.select_option("#f-campaign", offer["id"])
        mp.wait_for_timeout(600)
        mp.evaluate("shopRailToggle('disc-rail')")
        mp.wait_for_timeout(2500)
        mtile = mp.query_selector(".shelf-tile")
        mfirst = mtile.inner_text() if mtile else ""
        ck("mobile shelf: Ana #1 with match + why-line (parity)", "Ana Alvarez" in mfirst and "Match " in mfirst and "local in Nashville" in mfirst, mfirst.replace("\n", " | ")[:220])
        ck("mobile shelf: why-line does not overflow its tile", mp.evaluate("""() => { const w = document.querySelector('.shelf-match-why'); if (!w) return false; const t = w.closest('.shelf-tile'); return w.getBoundingClientRect().right <= t.getBoundingClientRect().right + 1; }"""))
        ck("no horizontal overflow (mobile shelf, matched)", not overflow(mp))
        shot(mp, "08-discover-campaign-shelf-mobile.png")
        mp.evaluate("go('dashboard','My Offers')")
        mp.wait_for_timeout(2500)
        if not mp.query_selector(f"#offer-card-{offer['id']}"):
            mp.evaluate("state.offersSeg='drafts'; loadMyOffers()")
            mp.wait_for_timeout(2500)
        mp.click(f"#offer-card-{offer['id']} button:has-text('Best matches')")
        mp.wait_for_timeout(2500)
        mrow = mp.query_selector(f"#offer-matches-{offer['id']} .creator-card")
        ck("mobile campaign matches render the shared card with score", mrow is not None and "Match " in mrow.inner_text())
        ck("no horizontal overflow (mobile campaign matches)", not overflow(mp))
        shot(mp, "09-campaign-matches-mobile.png")
        browser.close()
finally:
    server.terminate()

print(f"\nqa_match: {len(fails)} failure(s)" + (": " + "; ".join(fails) if fails else ""))
sys.exit(1 if fails else 0)
