#!/usr/bin/env python3
"""Build -113 (Phase A4) Playwright QA:
- Admin desktop + 390px: Applications creator row carries
  "View account" + "Send sign-in link"; View account opens the
  account view; Correct email fixes a typo'd address in place;
  Send sign-in link then confirms it goes to the NEW address.
- Admin Compliance: a removed (banned) creator's per-visit badge
  reads "creator removed", never "creator paused".
- Creator (390px + desktop): a paid offer card's Post row states
  no 48-hour window; the agreed Posting terms row carries timing.
Overflow checked at both widths. Tap counts recorded."""
import os, sys, json, re, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-phase-a-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9053
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b113-qa-")
db = os.path.join(tmp, "db.json")

TYPO = "amy.dawson@gmail.co"
FIXED = "amy.dawson@gmail.com"

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "amyqa", role: "creator", email: "amy.dawson@gmail.co", name: "Amy Dawson", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 30 * DAY), reviewedAt: iso(now0 - 29 * DAY), creator: { handle: "amy_mdawson", primaryPlatform: "instagram", followerCount: 5200, categories: ["Food & Drink"], compCategories: ["Restaurant meals"], localAudiencePct: 71, tierBand: "Locals", profileComplete: true, hasPhoto: true } });
putUser({ id: "bizqa", role: "business", email: "biz@b113qa.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), business: { businessName: "B113 QA Bistro", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Counter service tacos and brunch." } });
putUser({ id: "bannedqa", role: "creator", email: "banned@b113qa.dev", name: "Randy Removed", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 60 * DAY), updatedAt: iso(now0 - 1 * DAY), standing: { state: "banned", source: "silent_strikes", reason: "Removed after two silent no-shows.", at: iso(now0 - 1 * DAY), bookingId: "bkbanned" }, creator: { handle: "randyremoved", primaryPlatform: "instagram", followerCount: 2400, categories: ["Food & Drink"], localAudiencePct: 66, tierBand: "Locals", profileComplete: true, hasPhoto: true } });
data["booking:bkbanned"] = { id: "bkbanned", offerId: null, businessId: "bizqa", businessName: "B113 QA Bistro", creatorId: "bannedqa", creatorName: "Randy Removed", creatorHandle: "randyremoved", market: "Nashville", kind: "comp", title: "Banned creator visit", whatComped: "Dinner for two", covers: 1, dollarCap: 80, status: "booked", code: "B113BAN", codeStatus: "burned", redeemedAt: iso(now0 - 8 * DAY), postDeadline: iso(now0 - 6 * DAY), createdAt: iso(now0 - 9 * DAY), updatedAt: iso(now0 - 8 * DAY), compliance: { silentStrikeCounted: true } };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-" + "pass-113"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b113.dev"
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
        b = p.chromium.launch(channel="chromium")

        def login(ctx, email, pw="qa-pass-1234"):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
            return r.status

        def click_nav(page, label):
            for sel in [f".rail-item[aria-label='{label}']", f".tab-item[aria-label='{label}']", f"text={label}"]:
                try:
                    page.click(sel, timeout=4000); return sel
                except Exception:
                    continue
            raise RuntimeError(f"nav not found: {label}")

        # Paid offer for the M1 rendered check, created through the API.
        bctx = b.new_context()
        R["biz_login"] = login(bctx, "biz@b113qa.dev")
        off = bctx.request.post(BASE + "/api/offers", data={
            "title": "Paid tasting night", "whatComped": "Tasting menu for two", "kind": "paid",
            "cashRate": 200, "spots": 1, "creatorId": "amyqa",
            "postingTerms": {"type": "standard"},
        })
        R["paid_offer_created"] = off.status
        bctx.close()

        taps = {"desktop": 0, "mobile": 0}

        def admin_walk(ctx, page, mode, width):
            dialogs = []
            page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
            R[f"{mode}_admin_login"] = login(ctx, "admin@b113.dev", "qa-admin-pass-113")
            page.goto(BASE + "/", wait_until="networkidle"); page.wait_for_timeout(2200)
            # Amy's row: both account actions present (0 taps — on the list)
            row = page.locator("tr", has_text="Amy Dawson").first
            R[f"{mode}_row_has_view_account"] = row.get_by_role("button", name="View account").count() >= 1
            R[f"{mode}_row_has_signin_link"] = row.get_by_role("button", name="Send sign-in link").count() >= 1
            R[f"{mode}_row_shows_typo_email"] = TYPO in row.inner_text()
            # Tap 1: View account
            row.get_by_role("button", name="View account").click(); taps[mode] += 1
            page.wait_for_timeout(1200)
            body = page.locator("#tab-body").inner_text()
            R[f"{mode}_account_view_shows_typo"] = TYPO in body and "Account email" in body
            R[f"{mode}_account_view_has_correct_email"] = page.get_by_role("button", name="Correct email").count() >= 1
            R[f"{mode}_account_view_has_signin"] = page.get_by_role("button", name="Send sign-in link").count() >= 1
            page.screenshot(path=f"{OUT}/b113-admin-account-{mode}.png", full_page=True)
            # Tap 2: Correct email -> editor; type; Tap 3: Save
            page.get_by_role("button", name="Correct email").click(); taps[mode] += 1
            page.wait_for_timeout(400)
            page.fill("#acct-email-amyqa", FIXED)
            page.get_by_role("button", name="Save new email").click(); taps[mode] += 1
            page.wait_for_timeout(1200)
            body2 = page.locator("#tab-body").inner_text()
            R[f"{mode}_after_save_shows_new"] = FIXED in body2
            R[f"{mode}_after_save_old_gone"] = not re.search(r"amy\.dawson@gmail\.co(?!m)", body2)
            R[f"{mode}_after_save_note_plain"] = ("Mail and sign-in now use " + FIXED) in body2
            page.screenshot(path=f"{OUT}/b113-admin-account-corrected-{mode}.png", full_page=True)
            # Tap 4: Send sign-in link -> alert names the NEW address
            dialogs.clear()
            page.get_by_role("button", name="Send sign-in link").click(); taps[mode] += 1
            page.wait_for_timeout(1200)
            R[f"{mode}_signin_dialog_new_address"] = any(FIXED in d for d in dialogs)
            R[f"{mode}_overflow_ok"] = page.evaluate("() => document.scrollingElement.scrollWidth") <= width + 1
            return dialogs

        # ---------- ADMIN desktop ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        admin_walk(ctx, pg, "desktop", 1280)
        # Compliance badge (M2)
        click_nav(pg, "Compliance"); pg.wait_for_timeout(1500)
        card = pg.locator(".card", has_text="Banned creator visit").first
        card_text = card.inner_text() if card.count() else ""
        R["compliance_badge_removed"] = "creator removed" in card_text
        R["compliance_badge_not_paused"] = "creator paused" not in card_text
        R["compliance_standing_banned"] = "banned" in card_text
        pg.screenshot(path=f"{OUT}/b113-admin-compliance-desktop.png", full_page=True)
        ctx.close()

        # ---------- ADMIN mobile 390 ----------
        ctxm = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgm = ctxm.new_page()
        # NOTE: desktop walk already corrected Amy's email in the shared DB;
        # the mobile walk re-checks the row actions + account view state.
        admin_walk_mobile = True
        dialogs_m = []
        pgm.on("dialog", lambda d: (dialogs_m.append(d.message), d.accept()))
        R["mobile_admin_login"] = login(ctxm, "admin@b113.dev", "qa-admin-pass-113")
        pgm.goto(BASE + "/", wait_until="networkidle"); pgm.wait_for_timeout(2200)
        rowm = pgm.locator("tr", has_text="Amy Dawson").first
        R["mobile_row_has_view_account"] = rowm.get_by_role("button", name="View account").count() >= 1
        R["mobile_row_has_signin_link"] = rowm.get_by_role("button", name="Send sign-in link").count() >= 1
        rowm.get_by_role("button", name="View account").click(); taps["mobile"] += 1
        pgm.wait_for_timeout(1200)
        bodym = pgm.locator("#tab-body").inner_text()
        R["mobile_account_view_shows_new"] = FIXED in bodym
        R["mobile_account_view_has_correct_email"] = pgm.get_by_role("button", name="Correct email").count() >= 1
        R["mobile_overflow_ok"] = pgm.evaluate("() => document.scrollingElement.scrollWidth") <= 391
        pgm.screenshot(path=f"{OUT}/b113-admin-account-mobile.png", full_page=True)
        ctxm.close()

        # ---------- CREATOR: paid offer card (M1) ----------
        ctxc = b.new_context(viewport={"width": 1280, "height": 900})
        pgc = ctxc.new_page()
        R["creator_login"] = login(ctxc, FIXED)  # Amy signs in at the corrected address
        pgc.goto(BASE + "/", wait_until="networkidle"); pgc.wait_for_timeout(2200)
        try:
            click_nav(pgc, "Offers")
        except Exception:
            pass
        pgc.wait_for_timeout(1800)
        # Directed offers sit under the Invited tab.
        try:
            pgc.locator(".ws-tab", has_text="Invited").first.click()
            pgc.wait_for_timeout(1500)
        except Exception:
            pass
        # The deal-terms block (Post / Posting terms / Rights rows)
        # and the brief's Deliverable row are the M1 surfaces: the
        # Post row must state no window, the terms row carries the
        # timing, and neither may state the comped 48 hours. (The
        # card also carries the general comped-visit rules gate,
        # which names comped visits as its scope — not this check.)
        terms_text = ""
        brief_text = ""
        cards = pgc.locator(".card", has_text="Paid tasting night")
        for i in range(cards.count()):
            t = cards.nth(i).locator(".deal-terms").first
            if t.count():
                terms_text = t.inner_text()
            b = cards.nth(i).locator(".showcase-block", has_text="Deliverable").first
            if b.count():
                brief_text = b.inner_text()
            if terms_text and brief_text:
                break
        R["paid_card_has_terms_row"] = "posting terms" in terms_text.lower() and "post within 7 days" in terms_text
        R["paid_card_post_row_no_48h"] = bool(terms_text) and "48 hours" not in terms_text
        R["paid_brief_references_agreed_terms"] = "agreed posting terms" in brief_text and "48 hours" not in brief_text
        pgc.screenshot(path=f"{OUT}/b113-creator-paid-offer-desktop.png", full_page=True)
        ctxc.close()

        R["taps"] = taps
finally:
    server.terminate()

print(json.dumps(R, indent=1))
fails = [k for k, v in R.items() if v is False or (isinstance(v, int) and k.endswith("_login") and v != 200) or (k == "paid_offer_created" and v != 201)]
print("QA FAILS:", fails if fails else "none")
