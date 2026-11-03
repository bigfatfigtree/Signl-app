#!/usr/bin/env python3
"""Build -116 Playwright QA:
- Admin Applications DECK at desktop (1280) and phone (390):
  a pending creator card with photo, stacked total, platform
  split; the More actions row (Make tester, Correct email);
  approve advances; the under-500 card warns first and the
  server refusal shows on the deck; reject advances; the
  pending business card; the Queue clear done state.
- Find a user at 390: a search result card with the full
  servicing row and no decision buttons on an approved user.
- Markets grid: default, Most combined followers sort, By
  country and By status groups, desktop + one phone shot.
Overflow checked at every width. Chromium runs through the
local relay (127.0.0.1:8899) with loopback bypassed, per the
standing QA chain."""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build116-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9062
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b116-qa-")
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
const PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
putUser({ id: "dana", role: "creator", email: "dana@b116qa.dev", name: "Dana Deck", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 2 * DAY), updatedAt: iso(now0 - 2 * DAY), creator: { handle: "danadeck", primaryPlatform: "instagram", followerCount: 96500, totalAudience: 96500, audienceStack: { instagram: 84200, tiktok: 12300 }, categories: ["Food & Drink", "Nightlife"], localAudiencePct: 68, tierBand: "Headliners", profileComplete: true, hasPhoto: true, bio: "Nashville nights and late plates." } });
data["photo:dana"] = { contentType: "image/png", dataBase64: PX };
putUser({ id: "uma", role: "creator", email: "uma@b116qa.dev", name: "Uma Under", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 12 * 3600 * 1000), updatedAt: iso(now0 - 12 * 3600 * 1000), creator: { handle: "umaunder", primaryPlatform: "tiktok", followerCount: 300, totalAudience: 300, audienceStack: { tiktok: 300 }, categories: ["Coffee & Bakery"], localAudiencePct: 81, tierBand: "Neighbors", profileComplete: false, hasPhoto: false, bio: "" } });
putUser({ id: "diner", role: "business", email: "diner@b116qa.dev", name: "Dee Owner", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 6 * 3600 * 1000), updatedAt: iso(now0 - 6 * 3600 * 1000), business: { businessName: "Deck Diner", category: "Restaurant", plan: "growth", planId: "growth", about: "Counter diner on Gallatin." } });
putUser({ id: "mandy", role: "creator", email: "mandy@b116qa.dev", name: "Mandy Multi", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 40 * DAY), updatedAt: iso(now0 - 40 * DAY), reviewedAt: iso(now0 - 39 * DAY), creator: { handle: "multimandy", primaryPlatform: "instagram", followerCount: 15000, totalAudience: 15000, audienceStack: { instagram: 10000, tiktok: 5000 }, audienceMarkets: [{ market: "Richmond", pct: 20 }], categories: ["Food & Drink"], localAudiencePct: 55, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "" } });
putUser({ id: "rita", role: "creator", email: "rita@b116qa.dev", name: "Rita Richmond", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 30 * DAY), reviewedAt: iso(now0 - 29 * DAY), creator: { handle: "ritarichmond", primaryPlatform: "instagram", followerCount: 2000, totalAudience: 2000, audienceStack: { instagram: 2000 }, categories: ["Food & Drink"], localAudiencePct: 70, tierBand: "Neighbors", profileComplete: true, hasPhoto: false, bio: "" } });
putUser({ id: "lena", role: "creator", email: "lena@b116qa.dev", name: "Lena London", passwordSalt: salt, passwordHash: hash, status: "approved", market: "London", city: "London", createdAt: iso(now0 - 20 * DAY), updatedAt: iso(now0 - 20 * DAY), reviewedAt: iso(now0 - 19 * DAY), creator: { handle: "londonlena", primaryPlatform: "instagram", followerCount: 45000, totalAudience: 45000, audienceStack: { instagram: 45000 }, categories: ["Food & Drink"], localAudiencePct: 77, tierBand: "Headliners", profileComplete: true, hasPhoto: false, bio: "" } });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-" + "pass-116"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b116.dev"
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

        def login(ctx):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": "admin@b116.dev", "password": ADMIN_PW})
            return r.status

        def click_nav(page, label):
            for sel in [f".rail-item[aria-label='{label}']", f".tab-item[aria-label='{label}']", f"text={label}"]:
                try:
                    page.click(sel, timeout=4000); return sel
                except Exception:
                    continue
            raise RuntimeError(f"nav not found: {label}")

        def open_admin(width, height):
            ctx = b.new_context(viewport={"width": width, "height": height}, ignore_https_errors=True)
            page = ctx.new_page()
            page.on("dialog", lambda d: d.accept())
            R[f"login_{width}"] = login(ctx)
            page.goto(BASE + "/", wait_until="networkidle")
            page.wait_for_timeout(2200)
            click_nav(page, "Applications")
            page.wait_for_timeout(1500)
            return ctx, page

        # ---------- desktop: deck + markets ----------
        dctx, dpage = open_admin(1280, 900)
        body = dpage.locator("#tab-body").inner_text()
        R["deck_first_is_dana"] = "Dana Deck" in body and "danadeck" in body
        R["deck_shows_stacked_total"] = "96.5k" in body
        R["deck_shows_platform_split"] = "Instagram 84.2k" in body and "TikTok 12.3k" in body
        R["deck_shows_left_count"] = "3 left" in body
        R["deck_has_big_buttons"] = dpage.locator(".admin-deck-btn").count() == 2
        R["deck_photo_rendered"] = dpage.evaluate("(() => { const i = document.querySelector('.admin-card-photo'); return i ? (i.tagName === 'IMG' ? i.naturalWidth : -1) : 0; })()")
        dpage.screenshot(path=os.path.join(OUT, "deck-desktop.png"), full_page=True)
        dpage.get_by_role("button", name="More actions").click()
        dpage.wait_for_timeout(500)
        more = dpage.locator("#admin-deck-actions").inner_text()
        R["deck_more_has_servicing_row"] = all(s in more for s in ["View account", "Send sign-in link", "Correct email", "Make tester", "Partner attribution", "View profile"])
        dpage.screenshot(path=os.path.join(OUT, "deck-more-desktop.png"), full_page=True)
        R["deck_desktop_overflow"] = overflow(dpage)

        click_nav(dpage, "Markets")
        dpage.wait_for_selector(".mkt-card", timeout=10000)
        mbody = dpage.locator("#tab-body").inner_text()
        R["markets_are_cards"] = dpage.locator(".mkt-card").count() >= 10
        R["markets_label_honest"] = "combined followers (as reported by creators)" in mbody
        R["markets_london_reach"] = "45k" in mbody
        R["markets_richmond_reach"] = "17k" in mbody
        dpage.screenshot(path=os.path.join(OUT, "markets-default-desktop.png"), full_page=True)
        dpage.select_option("#admin-market-sort", "followers")
        dpage.wait_for_timeout(600)
        order = dpage.evaluate("(() => [...document.querySelectorAll('.mkt-name')].slice(0,3).map(e => e.textContent))()")
        R["markets_sort_followers_order"] = order
        R["markets_sort_followers_top_is_london"] = bool(order) and "London" in order[0]
        dpage.screenshot(path=os.path.join(OUT, "markets-sort-followers-desktop.png"), full_page=True)
        dpage.select_option("#admin-market-group", "country")
        dpage.wait_for_timeout(600)
        gbody = dpage.locator("#tab-body").inner_text()
        R["markets_group_country_headings"] = "United States" in gbody and "United Kingdom" in gbody
        dpage.screenshot(path=os.path.join(OUT, "markets-group-country-desktop.png"), full_page=True)
        dpage.select_option("#admin-market-group", "status")
        dpage.select_option("#admin-market-sort", "default")
        dpage.wait_for_timeout(600)
        sbody = dpage.locator("#tab-body").inner_text()
        # Test mode reads every market live, so the status
        # grouping yields its single non-empty section ("Live");
        # the empty "Founding only" section is not rendered.
        R["markets_group_status_headings"] = "Live" in sbody and dpage.locator(".mkt-grid").count() == 1
        dpage.screenshot(path=os.path.join(OUT, "markets-group-status-desktop.png"), full_page=True)
        R["markets_desktop_overflow"] = overflow(dpage)
        dctx.close()

        # ---------- phone: the full decision walk ----------
        mctx, mpage = open_admin(390, 844)
        mpage.screenshot(path=os.path.join(OUT, "deck-390.png"), full_page=True)
        R["deck_390_overflow"] = overflow(mpage)
        # Approve Dana -> Uma's card, with the under-500 warning up front
        mpage.wait_for_selector(".admin-deck-card", timeout=10000)
        mpage.locator(".admin-deck-decide").get_by_role("button", name="Approve", exact=True).click()
        mpage.wait_for_function("() => document.getElementById('tab-body').innerText.includes('Uma Under')", timeout=10000)
        body = mpage.locator("#tab-body").inner_text()
        R["after_approve_advances_to_uma"] = "Uma Under" in body
        R["after_approve_note"] = "Approved @danadeck." in body
        R["under500_warning_on_card"] = "Under the 500 minimum" in body
        R["under500_count_left"] = "2 left" in body
        mpage.screenshot(path=os.path.join(OUT, "deck-under500-390.png"), full_page=True)
        # Approve anyway -> the server refusal lands on the deck, card stays
        mpage.locator(".admin-deck-decide").get_by_role("button", name="Approve", exact=True).click()
        mpage.wait_for_function("() => document.getElementById('tab-body').innerText.includes('stays pending until their audience reaches 500')", timeout=10000)
        body = mpage.locator("#tab-body").inner_text()
        R["refusal_shows_on_deck"] = "stays pending until their audience reaches 500" in body
        R["refusal_card_did_not_advance"] = "Uma Under" in body and "2 left" in body
        mpage.screenshot(path=os.path.join(OUT, "deck-refused-390.png"), full_page=True)
        # Reject Uma with a reason -> the business card
        mpage.locator(".admin-deck-decide").get_by_role("button", name="Reject", exact=True).click()
        mpage.wait_for_timeout(500)
        mpage.select_option("#admin-deck-rej-reason", label="Content not a fit")
        mpage.get_by_role("button", name="Send rejection").click()
        mpage.wait_for_function("() => document.getElementById('tab-body').innerText.includes('Deck Diner')", timeout=10000)
        body = mpage.locator("#tab-body").inner_text()
        R["after_reject_advances_to_business"] = "Deck Diner" in body
        R["after_reject_note"] = "Rejected @umaunder." in body
        mpage.screenshot(path=os.path.join(OUT, "deck-business-390.png"), full_page=True)
        # Approve the business -> Queue clear
        mpage.locator(".admin-deck-decide").get_by_role("button", name="Approve", exact=True).click()
        mpage.wait_for_function("() => document.getElementById('tab-body').innerText.includes('Queue clear')", timeout=10000)
        body = mpage.locator("#tab-body").inner_text()
        R["done_state_queue_clear"] = "Queue clear" in body
        R["done_state_counts"] = "You decided 3 this session: 2 approved, 1 rejected." in body
        mpage.screenshot(path=os.path.join(OUT, "deck-done-390.png"), full_page=True)
        # Find a user: Mandy's card, full row, no decision buttons
        mpage.fill("#admin-user-q", "mandy")
        mpage.get_by_role("button", name="Search", exact=True).click()
        mpage.wait_for_function("() => document.getElementById('admin-user-results').innerText.includes('Mandy Multi')", timeout=10000)
        rbody = mpage.locator("#admin-user-results").inner_text()
        R["search_finds_mandy"] = "Mandy Multi" in rbody and "multimandy" in rbody
        R["search_card_full_row"] = all(s in rbody for s in ["View account", "Send sign-in link", "Correct email", "Make tester", "View profile"])
        R["search_card_no_decision_buttons"] = mpage.locator("#admin-user-results .admin-card-decide").count() == 0
        R["search_card_shows_total"] = "15k" in rbody
        mpage.screenshot(path=os.path.join(OUT, "search-result-390.png"), full_page=True)
        R["search_390_overflow"] = overflow(mpage)
        # No-match state
        mpage.fill("#admin-user-q", "zzzzqq")
        mpage.get_by_role("button", name="Search", exact=True).click()
        mpage.wait_for_timeout(1200)
        R["search_no_match_state"] = "No user matches that." in mpage.locator("#admin-user-results").inner_text()
        mctx.close()

        # ---------- phone: markets ----------
        kctx, kpage = open_admin(390, 844)
        click_nav(kpage, "Markets")
        kpage.wait_for_selector(".mkt-card", timeout=10000)
        kpage.screenshot(path=os.path.join(OUT, "markets-390.png"), full_page=True)
        R["markets_390_overflow"] = overflow(kpage)
        kctx.close()
finally:
    server.kill()

print(json.dumps(R, indent=1))
bad = [k for k, v in R.items() if v is False or (isinstance(v, int) and "overflow" in k and v > 1) or (k == "deck_photo_rendered" and v == 0)]
print("QA RESULT:", "ALL PASS" if not bad else f"ISSUES: {bad}")
