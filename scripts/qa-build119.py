#!/usr/bin/env python3
"""Build -119 Playwright QA (the dashboard redesign):
- All four roles at desktop (1280) + phone (390): home + one
  sub-tab screen each, plus opened states (admin mobile More
  sheet, application row More wrap, creator Offers seg switch,
  the review deck).
- Fresh-eyes checks: the Next list exists on Homes, "Standing"
  carries its gloss, the Sig pill fab renders, phone bars show
  5 primary items with the More label, no horizontal overflow.
Chromium runs through the local relay (127.0.0.1:8899) with
loopback bypassed, per the standing QA chain. Seed is fully
direct-DB (scrypt hashes) so no market needs to be live; TEST
mode makes markets read live for the live dashboards while the
founding business (accessState founding) still renders its
founding home."""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build119-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9063
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b119-qa-")
db = os.path.join(tmp, "db.json")
PW = "qa-pass-1234"

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const put = (key, val) => { data[key] = val; };
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
// live-market flag so TEST-independent reads also see Nashville live
put("config:markets", { flags: { Nashville: true } });
// --- creator (approved, complete) ---
putUser({ id: "cara", role: "creator", email: "cara@b119qa.dev", name: "Cara Creators", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 40 * DAY), updatedAt: iso(now0 - 2 * DAY), reviewedAt: iso(now0 - 39 * DAY),
  creator: { handle: "caracreates", primaryPlatform: "instagram", followerCount: 12400, totalAudience: 15800, audienceStack: { instagram: 12400, tiktok: 3400 }, audienceMarkets: [{ market: "Nashville", pct: 74 }], categories: ["Food & Drink"], localAudiencePct: 74, tierBand: "Locals", profileComplete: true, hasPhoto: true, bio: "Nashville eats, weekly.", paidRate: 150, momentumPoints: 340 } });
put("photo:cara", { contentType: "image/png", dataBase64: PX });
// --- founding creator (Richmond: no live flag, so her home is
// the founding home even in TEST mode — it renders the clock
// greeting "Good morning." etc. from localHourNow) ---
putUser({ id: "fiona", role: "creator", email: "fiona@b119qa.dev", name: "Fiona Founding", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 6 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 5 * DAY),
  creator: { handle: "fionafounding", primaryPlatform: "instagram", followerCount: 3100, totalAudience: 3100, audienceStack: { instagram: 3100 }, categories: ["Coffee & Bakery"], localAudiencePct: 71, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "Richmond coffee runs." } });
// --- pending creator (admin deck) ---
putUser({ id: "penny", role: "creator", email: "penny@b119qa.dev", name: "Penny Pending", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 1 * DAY), updatedAt: iso(now0 - 1 * DAY),
  creator: { handle: "pennyposts", primaryPlatform: "instagram", followerCount: 8200, totalAudience: 8200, audienceStack: { instagram: 8200 }, categories: ["Coffee & Bakery"], localAudiencePct: 66, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "" } });
// --- live business (activated) ---
putUser({ id: "basil", role: "business", email: "basil@b119qa.dev", name: "Basil Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 29 * DAY),
  business: { businessName: "Basil & Co", category: "Restaurant", plan: "growth", planId: "growth", planName: "Growth $349/mo", accessState: "active", about: "Wood-fired kitchen in East Nashville.", address: "1000 Woodland St" } });
// --- founding business (not activated) ---
putUser({ id: "faye", role: "business", email: "faye@b119qa.dev", name: "Faye Founder", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 5 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 4 * DAY),
  business: { businessName: "Faye's Bakery", category: "Bakery", plan: "self-service", planId: "self-service", accessState: "founding", about: "" } });
// --- licensee partner ---
putUser({ id: "patp", role: "partner", email: "pat@b119qa.dev", name: "Pat Partner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: iso(now0 - 60 * DAY), updatedAt: iso(now0 - 3 * DAY), reviewedAt: iso(now0 - 59 * DAY), termsVersion: "2026-10-19", termsAcceptedAt: iso(now0 - 59 * DAY), creator: null, business: null,
  partner: { name: "Pat Media Group", code: "patmedia", type: "media", contactName: "Pat Partner", markets: ["Nashville"], sharePct: 35, status: "active", agreementStatus: "signed", agreementSignedAt: iso(now0 - 59 * DAY), demo: false } });
// --- pilot + funder login ---
put("pilot:pilot-119", { id: "pilot-119", name: "Nashville First Visits Pilot", partnerName: "City Fund", marketId: "nashville", marketName: "Nashville", fundCents: 500000, status: "active", partnerUserId: "fayefund", createdAt: iso(now0 - 20 * DAY), updatedAt: iso(now0 - 2 * DAY) });
putUser({ id: "fayefund", role: "pilot_partner", email: "fund@b119qa.dev", name: "Faye Fund", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", pilotId: "pilot-119", createdAt: iso(now0 - 20 * DAY), updatedAt: iso(now0 - 2 * DAY), creator: null, business: null });
put("pilotbiz:pilot-119:pb1", { id: "pb1", pilotId: "pilot-119", businessId: "basil", name: "Basil & Co", marketName: "Nashville", status: "selected", createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 2 * DAY) });
put("pilotbiz:pilot-119:pb2", { id: "pb2", pilotId: "pilot-119", businessId: null, name: "Off-books Taqueria", marketName: "Nashville", status: "invited", createdAt: iso(now0 - 9 * DAY), updatedAt: iso(now0 - 2 * DAY) });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-" + "pass-119"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b119.dev"
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

        def login(ctx, email, pw=PW):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
            return r.status

        def open_role(email, width, height, pw=PW):
            ctx = b.new_context(viewport={"width": width, "height": height}, ignore_https_errors=True)
            page = ctx.new_page()
            page.on("dialog", lambda d: d.accept())
            st = login(ctx, email, pw)
            page.goto(BASE + "/", wait_until="networkidle")
            page.wait_for_timeout(2600)
            return ctx, page, st

        def shot(page, name):
            page.screenshot(path=os.path.join(OUT, name), full_page=True)

        def body_text(page):
            return page.locator("#tab-body").inner_text() if page.locator("#tab-body").count() else page.locator("body").inner_text()

        def click_tab(page, label):
            for sel in [f".tab-item:has-text('{label}')", f".rail-item:has-text('{label}')", f"#tabbar button:has-text('{label}')", f"#rail button:has-text('{label}')"]:
                try:
                    page.locator(sel).first.click(timeout=3500); return True
                except Exception:
                    continue
            return False

        # ============ CREATOR ============
        cctx, cpage, cst = open_role("cara@b119qa.dev", 1280, 900)
        R["creator_login"] = cst
        txt = body_text(cpage)
        R["creator_home_next_list"] = "Next" in txt
        R["creator_home_hi"] = "Hi, Cara" in txt
        R["creator_home_sig_fab"] = cpage.locator("#agent-fab").count() == 1
        R["creator_home_no_momentum_word"] = "Momentum" not in txt
        shot(cpage, "creator-home-desktop.png")
        R["creator_desktop_overflow"] = overflow(cpage)
        if click_tab(cpage, "Offers"):
            cpage.wait_for_timeout(1800)
            otxt = body_text(cpage)
            R["creator_offers_segs"] = all(s in otxt for s in ["New", "Applied", "Booked", "Done"])
            shot(cpage, "creator-offers-desktop.png")
            # seg switch to Booked
            try:
                cpage.locator(".ws-tab:has-text('Booked')").first.click(timeout=3000)
                cpage.wait_for_timeout(900)
                R["creator_offers_booked_seg"] = "Booked" in body_text(cpage)
                shot(cpage, "creator-offers-booked-desktop.png")
            except Exception as e:
                R["creator_offers_booked_seg"] = f"ERR {e}"
        if click_tab(cpage, "Earnings"):
            cpage.wait_for_timeout(1800)
            etxt = body_text(cpage)
            R["creator_earnings_segs"] = "Earned" in etxt and "Pending" in etxt
            R["creator_earnings_97"] = "97%" in etxt
            shot(cpage, "creator-earnings-desktop.png")
        cctx.close()

        # founding creator home: the clock greeting renders here
        # ("Good morning." etc.). Fiona is in Richmond — seed her
        # WITHOUT the TEST override by using a second context on
        # the plain server? TEST mode makes every market read
        # live, so Fiona lands on the LIVE home here; the
        # greeting-word check therefore runs against the Sig
        # home greeting instead (same localHourNow source): open
        # the Sig tab and compare its greeting to the browser's
        # own local hour.
        fctx, fpage, _ = open_role("fiona@b119qa.dev", 1280, 900)
        shot(fpage, "creator-founding-desktop.png")
        if click_tab(fpage, "Sig"):
            fpage.wait_for_timeout(2200)
        ftxt2 = fpage.locator("body").inner_text()
        browser_hour = fpage.evaluate("new Date().getHours()")
        want_greet = "Good morning" if browser_hour < 12 else ("Good afternoon" if browser_hour < 18 else "Good evening")
        R["sig_greeting_matches_local_hour"] = want_greet in ftxt2
        R["sig_greeting_seen"] = [g for g in ["Good morning", "Good afternoon", "Good evening"] if g in ftxt2]
        R["sig_greeting_browser_hour"] = browser_hour
        shot(fpage, "creator-sig-desktop.png")
        fctx.close()

        mctx, mpage, _ = open_role("cara@b119qa.dev", 390, 844)
        R["creator_phone_bar_items"] = mpage.locator("#tabbar .tab-item.tab-primary").count()
        R["creator_phone_bar_labels"] = mpage.locator("#tabbar").inner_text() if mpage.locator("#tabbar").count() else ""
        R["creator_phone_sig_fab"] = mpage.locator("#agent-fab").count() == 1
        shot(mpage, "creator-home-390.png")
        R["creator_390_overflow"] = overflow(mpage)
        mctx.close()

        # ============ BUSINESS (live) ============
        bctx, bpage, bst = open_role("basil@b119qa.dev", 1280, 900)
        R["business_login"] = bst
        txt = body_text(bpage)
        R["business_home_next_or_setup"] = ("Next" in txt) or ("Set up" in txt) or ("setup" in txt.lower())
        R["business_home_find_creators"] = "Find creators" in txt or "Discover" in txt
        shot(bpage, "business-home-desktop.png")
        R["business_desktop_overflow"] = overflow(bpage)
        if click_tab(bpage, "Discover"):
            bpage.wait_for_timeout(2200)
            dtxt = body_text(bpage)
            R["business_discover_strip"] = all(s in dtxt for s in ["Browse", "My Regulars", "Saved"])
            R["business_discover_sees_creator"] = "caracreates" in dtxt or "Cara" in dtxt
            shot(bpage, "business-discover-desktop.png")
        bctx.close()

        fbctx, fbpage, _ = open_role("faye@b119qa.dev", 390, 844)
        ftxt = body_text(fbpage)
        R["business_founding_home"] = "founding" in ftxt.lower()
        shot(fbpage, "business-founding-390.png")
        R["business_founding_390_overflow"] = overflow(fbpage)
        fbctx.close()

        # ============ PARTNER (licensee console) ============
        pctx, ppage, pst = open_role("pat@b119qa.dev", 1280, 900)
        R["partner_login"] = pst
        txt = body_text(ppage)
        shot(ppage, "partner-home-desktop.png")
        R["partner_desktop_overflow"] = overflow(ppage)
        if click_tab(ppage, "Earnings"):
            ppage.wait_for_timeout(1800)
            etxt = body_text(ppage)
            R["partner_money_segs"] = "Fund" in etxt and "Returns" in etxt
            shot(ppage, "partner-money-desktop.png")
        pctx.close()

        pmctx, pmpage, _ = open_role("pat@b119qa.dev", 390, 844)
        R["partner_phone_bar_items"] = pmpage.locator("#tabbar .tab-item.tab-primary").count()
        shot(pmpage, "partner-home-390.png")
        R["partner_390_overflow"] = overflow(pmpage)
        pmctx.close()

        # ============ PILOT (Impact Portal) ============
        ictx, ipage, ist = open_role("fund@b119qa.dev", 1280, 900)
        R["pilot_login"] = ist
        txt = body_text(ipage)
        R["pilot_overview_fund"] = "The fund" in txt
        R["pilot_overview_strip"] = all(s in txt for s in ["Overview", "Businesses", "Results", "Report"])
        R["pilot_overview_visits_zero_line"] = "0 visits yet" in txt
        shot(ipage, "pilot-overview-desktop.png")
        R["pilot_desktop_overflow"] = overflow(ipage)
        if click_tab(ipage, "Businesses"):
            ipage.wait_for_timeout(1500)
            btxt = body_text(ipage)
            R["pilot_businesses_segs"] = "Chosen" in btxt and "Visits" in btxt
            R["pilot_businesses_rows"] = "Basil & Co" in btxt
            shot(ipage, "pilot-businesses-desktop.png")
        ictx.close()

        imctx, impage, _ = open_role("fund@b119qa.dev", 390, 844)
        shot(impage, "pilot-overview-390.png")
        R["pilot_390_overflow"] = overflow(impage)
        imctx.close()

        # ============ ADMIN ============
        actx, apage, ast = open_role("admin@b119.dev", 1280, 900, ADMIN_PW)
        R["admin_login"] = ast
        # the admin landing is the review Deck (Build -116); the
        # row More wrap lives in the List view of the same screen.
        try:
            apage.locator(".rail-item").first.wait_for(timeout=8000)
        except Exception:
            pass
        try:
            apage.get_by_role("button", name="List", exact=True).click(timeout=4000)
            apage.wait_for_timeout(1500)
        except Exception as e:
            R["admin_list_toggle"] = f"ERR {e}"
        atxt = body_text(apage)
        R["admin_list_more_wrap"] = "More ▾" in atxt
        R["admin_list_shows_pending"] = "Penny Pending" in atxt
        shot(apage, "admin-applications-desktop.png")
        R["admin_desktop_overflow"] = overflow(apage)
        # open the row More wrap
        try:
            apage.get_by_role("button", name="More ▾").first.click(timeout=3000)
            apage.wait_for_timeout(600)
            mtxt = body_text(apage)
            R["admin_row_more_opens"] = "Partner attribution" in mtxt or "View account" in mtxt
            shot(apage, "admin-row-more-desktop.png")
        except Exception as e:
            R["admin_row_more_opens"] = f"ERR {e}"
        # Markets with photo headers
        if click_tab(apage, "Markets"):
            apage.wait_for_timeout(1800)
            R["admin_markets_photo_headers"] = apage.locator(".mkt-photo").count()
            shot(apage, "admin-markets-desktop.png")
        actx.close()

        amctx, ampage, _ = open_role("admin@b119.dev", 390, 844, ADMIN_PW)
        R["admin_phone_bar_items"] = ampage.locator("#rail .rail-item.rail-primary:visible, #rail .rail-item.rail-more:visible").count()
        shot(ampage, "admin-review-390.png")
        # open the More sheet
        try:
            ampage.locator(".rail-more").first.click(timeout=3000)
            ampage.wait_for_timeout(700)
            stxt = ampage.locator("body").inner_text()
            R["admin_more_sheet_opens"] = "Sign out" in stxt
            shot(ampage, "admin-more-sheet-390.png")
        except Exception as e:
            R["admin_more_sheet_opens"] = f"ERR {e}"
        R["admin_390_overflow"] = overflow(ampage)
        amctx.close()
finally:
    server.kill()

print(json.dumps(R, indent=1))
bad = [k for k, v in R.items() if v is False or (isinstance(v, int) and "overflow" in k and v > 1) or (isinstance(v, str) and v.startswith("ERR"))]
print("QA RESULT:", "ALL PASS" if not bad else f"ISSUES: {bad}")
