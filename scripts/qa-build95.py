#!/usr/bin/env python3
"""Build -95 Playwright QA: My Regulars (populated + empty),
the licence-expiry card on Posts & licenses, and the real
navigation walk: business Home -> rail "My Regulars" (1 tap),
Home -> rail "Posts & licenses" (1 tap). Desktop + 390px."""
import os, sys, json, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-audit-2026-11-01/fix-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 8974
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b95-qa-")
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
putUser({ id: "bizqa", role: "business", email: "biz@b95qa.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), phone: "+15550001111", business: { businessName: "B95 QA Bistro", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Counter service tacos and brunch." } });
putUser({ id: "bizempty", role: "business", email: "empty@b95qa.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), business: { businessName: "B95 Empty Kitchen", category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "active", about: "New spot." } });
putUser({ id: "crqa", role: "creator", email: "casey@b95qa.dev", name: "Casey Creator", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), creator: { handle: "b95casey", followerCount: 3000, categories: ["Food & Drink"], localAudiencePct: 70, licensingFee: 80, tierBand: "Locals" } });
putUser({ id: "crqa2", role: "creator", email: "paige@b95qa.dev", name: "Paige Paid", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), creator: { handle: "b95paige", followerCount: 5200, categories: ["Food & Drink"], localAudiencePct: 64, licensingFee: 120, tierBand: "Locals" } });
function booking(id, creatorId, creatorName, creatorHandle, over = {}) {
  data[`booking:${id}`] = { id, offerId: `off-${id}`, businessId: "bizqa", businessName: "B95 QA Bistro", creatorId, creatorName, creatorHandle, market: "Nashville", category: "Restaurant", kind: "comp", title: "Comp dinner", whatComped: "Meal for two, on us", covers: 2, dollarCap: 100, status: "completed", redeemedAt: iso(now0 - 9 * DAY), createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 8 * DAY), redemptions: { count: 7, basketTotal: 210 }, ...over };
}
function post(id, bookingId, creatorId, over = {}) {
  data[`post:${id}`] = { id, bookingId, businessId: "bizqa", creatorId, url: `https://www.instagram.com/p/${id}/`, createdAt: iso(now0 - 8 * DAY), submittedAt: iso(now0 - 8 * DAY), reportedAt: iso(now0 - 8 * DAY), views: 5000, likes: 300, shares: 40, saves: 60, onTime: true, ...over };
}
booking("bk1", "crqa", "Casey Creator", "b95casey");
post("p1", "bk1", "crqa");
data["post:p1"].license = { requestId: "lic1", fee: 80, grantedAt: iso(now0 - 80 * DAY), windowEndsAt: iso(now0 + 10 * DAY), status: "granted" };
data["license:lic1"] = { id: "lic1", postId: "p1", bookingId: "bk1", businessId: "bizqa", businessName: "B95 QA Bistro", creatorId: "crqa", creatorHandle: "b95casey", fee: 80, businessTotal: 82.4, creatorNet: 77.6, licenseDays: 90, status: "granted", escrowState: "released", createdAt: iso(now0 - 80 * DAY), respondedAt: iso(now0 - 80 * DAY), windowEndsAt: iso(now0 + 10 * DAY) };
booking("bk2", "crqa2", "Paige Paid", "b95paige", { kind: "paid", title: "Paid dinner", dollarCap: 200, paidLane: { rate: 200, businessTotal: 206, creatorNet: 194, platformFee: 12, licenseDays: 90, escrowState: "released" }, redemptions: null });
post("p2", "bk2", "crqa2", { views: 2400, likes: 110, shares: 9, saves: 14 });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE, ADMIN_EMAIL="admin@b95.dev", ADMIN_PASSWORD="<redacted>")
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

        def login(ctx, email):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": "qa-pass-1234"})
            return r.status

        # ---------- desktop: home -> rail My Regulars (1 tap) ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["biz_login"] = login(ctx, "biz@b95qa.dev")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(1800)
        R["home_has_rail_regulars"] = pg.evaluate("""() => {
          const items = [...document.querySelectorAll('.tab-item')];
          return items.some(i => (i.getAttribute('aria-label') || '') === 'My Regulars');
        }""")
        pg.screenshot(path=f"{OUT}/b95-home-desktop.png", full_page=False)
        # the actual navigation path: one tap on the rail item
        pg.click(".tab-item[aria-label='My Regulars']")
        pg.wait_for_timeout(1200)
        R["regulars_nav_1tap"] = pg.evaluate("() => document.body.innerText.includes('Book again') && document.body.innerText.includes('Counted:')")
        R["regulars_overflow_desktop"] = pg.evaluate("() => document.scrollingElement.scrollWidth")
        pg.screenshot(path=f"{OUT}/b95-regulars-desktop.png", full_page=True)
        # note save through the real UI
        pg.fill("#reg-note-crqa", "Great with the weekend brunch crowd")
        pg.click("text=Save note"); pg.wait_for_timeout(700)
        R["note_saved_ui"] = pg.evaluate("() => (document.getElementById('reg-note-ok-crqa') || {}).textContent || ''")
        # Content: licence-expiry card (Home -> rail Posts & licenses, 1 tap)
        pg.click(".tab-item[aria-label='Posts & licenses']")
        pg.wait_for_timeout(1500)
        R["licence_card_visible"] = pg.evaluate("() => document.body.innerText.includes('Licences ending soon') && document.body.innerText.includes('Ask to renew')")
        pg.screenshot(path=f"{OUT}/b95-licence-expiry-desktop.png", full_page=True)
        ctx.close()

        # ---------- mobile 390px: Regulars ----------
        ctxm = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgm = ctxm.new_page()
        login(ctxm, "biz@b95qa.dev")
        pgm.goto(BASE + "/", wait_until="networkidle"); pgm.wait_for_timeout(1800)
        pgm.click(".tab-item[aria-label='My Regulars']")
        pgm.wait_for_timeout(1200)
        R["mobile_overflow"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        pgm.screenshot(path=f"{OUT}/b95-regulars-mobile.png", full_page=True)
        # mobile: licence card too
        pgm.click(".tab-item[aria-label='Posts & licenses']")
        pgm.wait_for_timeout(1500)
        R["mobile_licence_card"] = pgm.evaluate("() => document.body.innerText.includes('Licences ending soon')")
        pgm.screenshot(path=f"{OUT}/b95-licence-expiry-mobile.png", full_page=True)
        ctxm.close()

        # ---------- empty state: a business with no completed visits ----------
        ctxe = b.new_context(viewport={"width": 1280, "height": 900})
        pge = ctxe.new_page()
        login(ctxe, "empty@b95qa.dev")
        pge.goto(BASE + "/", wait_until="networkidle"); pge.wait_for_timeout(1800)
        pge.click(".tab-item[aria-label='My Regulars']")
        pge.wait_for_timeout(1200)
        R["empty_state"] = pge.evaluate("() => document.body.innerText.includes('No Regulars yet')")
        pge.screenshot(path=f"{OUT}/b95-regulars-empty-desktop.png", full_page=True)
        ctxe.close()
        b.close()
finally:
    server.terminate()

print(json.dumps(R, indent=1))
