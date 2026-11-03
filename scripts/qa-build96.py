#!/usr/bin/env python3
"""Build -96 Playwright QA: the forwardable Monthly Receipt
export (Results surface + print view), standing availability
(editor save through the real UI, composer pre-fill, the
creator-facing line on the offer board), Sig serving the
receipt in-thread, and the real navigation walks:
business Home -> rail "Results" (1 tap), Home -> rail
"Your business page" (1 tap). Desktop + 390px."""
import os, sys, json, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-audit-2026-11-01/fix-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 8976
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b96-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const curKey = iso(now0).slice(0, 7);
const [cy, cm] = curKey.split("-").map(Number);
const prevMid = Date.UTC(cy, cm - 2, 15, 12, 0, 0);
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "bizqa", role: "business", email: "biz@b96qa.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), phone: "+15550001111", business: { businessName: "Chelsea's Friday Furniture", category: "Furniture & Home", plan: "growth", planId: "growth", accessState: "active", about: "Hand-picked vintage furniture, new pieces every Friday." } });
putUser({ id: "biz2", role: "business", email: "biz2@b96qa.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), business: { businessName: "B96 QA Supper Club", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Small plates and natural wine.", standingAvailability: { days: ["Fri", "Sat", "Sun"], hours: "12 to 4", appointments: "Tue to Thu by appointment" } } });
putUser({ id: "crqa", role: "creator", email: "casey@b96qa.dev", name: "Casey Creator", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), creator: { handle: "b96casey", followerCount: 3000, categories: ["Food & Drink"], localAudiencePct: 70, licensingFee: 80, tierBand: "Locals" } });
function booking(id, over = {}) {
  data[`booking:${id}`] = { id, offerId: `off-${id}`, businessId: "bizqa", businessName: "Chelsea's Friday Furniture", creatorId: "crqa", creatorName: "Casey Creator", creatorHandle: "b96casey", market: "Nashville", category: "Furniture & Home", kind: "comp", title: "Store visit", whatComped: "First pick of the Friday drop", covers: 2, dollarCap: 100, status: "completed", redeemedAt: iso(now0 - 1 * DAY), createdAt: iso(now0 - 2 * DAY), updatedAt: iso(now0 - 1 * DAY), redemptions: null, ...over };
}
function post(id, bookingId, over = {}) {
  data[`post:${id}`] = { id, bookingId, businessId: "bizqa", creatorId: "crqa", url: `https://www.instagram.com/p/${id}/`, createdAt: iso(now0 - 1 * DAY), submittedAt: iso(now0 - 1 * DAY), reportedAt: iso(now0 - 1 * DAY), views: 4000, likes: 200, shares: 30, saves: 50, onTime: true, ...over };
}
function ev(id, bookingId, kind, amount, atMs) {
  data[`redevent:${id}`] = { id, bookingId, businessId: "bizqa", creatorId: "crqa", kind, channel: "code", amount, passId: null, at: iso(atMs), by: "bizqa", via: "owner", flagged: false };
}
booking("bk-prev", { createdAt: iso(prevMid - DAY), redeemedAt: iso(prevMid), updatedAt: iso(prevMid) });
post("p-prev", "bk-prev", { createdAt: iso(prevMid), submittedAt: iso(prevMid), reportedAt: iso(prevMid), views: 900, likes: 40, shares: 5, saves: 7 });
ev("ev-prev", "bk-prev", "first", 60, prevMid);
booking("bk-cur");
post("p-cur", "bk-cur");
data["post:p-cur"].license = { requestId: "lic-q", fee: 80, grantedAt: iso(now0 - 60 * DAY), windowEndsAt: iso(now0 + 30 * DAY), status: "granted" };
data["license:lic-q"] = { id: "lic-q", postId: "p-cur", bookingId: "bk-cur", businessId: "bizqa", businessName: "Chelsea's Friday Furniture", creatorId: "crqa", creatorHandle: "b96casey", fee: 80, businessTotal: 82.4, creatorNet: 77.6, licenseDays: 90, status: "granted", escrowState: "released", createdAt: iso(now0 - 60 * DAY), respondedAt: iso(now0 - 60 * DAY), windowEndsAt: iso(now0 + 30 * DAY) };
ev("ev-c1", "bk-cur", "first", 120, now0 - DAY);
ev("ev-c2", "bk-cur", "first", 80, now0 - DAY);
ev("ev-c3", "bk-cur", "return", 45, now0 - DAY);
data["offer:off-open1"] = { id: "off-open1", businessId: "biz2", status: "open", kind: "comp", market: "Nashville", category: "Restaurant", title: "Weekend tasting", whatComped: "Tasting menu for two", dollarCap: 120, spots: 3, targetTiers: ["Locals"], createdAt: iso(now0 - 3 * DAY), updatedAt: iso(now0 - 3 * DAY) };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE, ADMIN_EMAIL="admin@b96.dev", ADMIN_PASSWORD="<redacted>")
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

        # ---------- desktop business: Home prompts ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["biz_login"] = login(ctx, "biz@b96qa.dev")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2200)
        R["home_prompts"] = pg.evaluate("""() => {
          const t = document.body.textContent;
          return { hours: t.includes('Set your standing hours once'), receipt: t.includes('receipt is ready to forward'), seeall: t.includes('See all') };
        }""")
        pg.screenshot(path=f"{OUT}/b96-home-desktop.png", full_page=False)
        # expand the queue so both prompts are visible, and shoot them
        try:
            pg.click(".sig-seeall", timeout=3000)
            pg.wait_for_timeout(500)
            R["home_prompts_visible"] = pg.evaluate("""() => {
              const t = document.body.innerText;
              return { hours: t.includes('Set your standing hours once'), receipt: t.includes('receipt is ready to forward') };
            }""")
            pg.screenshot(path=f"{OUT}/b96-home-queue-desktop.png", full_page=True)
        except Exception as e:
            R["home_prompts_visible"] = f"no see-all: {str(e)[:80]}"

        # ---------- Home -> rail "Results" (1 tap): the export surface ----------
        pg.click(".tab-item[aria-label='Results']")
        pg.wait_for_timeout(2500)
        R["results_nav_1tap"] = pg.evaluate("() => !!document.getElementById('receipt-export-card')")
        R["export_card_text"] = pg.evaluate("""() => {
          const el = document.getElementById('receipt-export-card');
          if (!el) return '';
          const t = el.innerText;
          return ['Forward', 'Counted', 'Recorded', 'Intent', 'never added together', 'Download CSV', 'Print or save as PDF'].filter((s) => t.includes(s)).join('|');
        }""")
        pg.evaluate("() => { const el = document.getElementById('receipt-export-card'); if (el) el.scrollIntoView(); }")
        pg.wait_for_timeout(400)
        pg.screenshot(path=f"{OUT}/b96-results-desktop.png", full_page=False)
        R["results_overflow_desktop"] = pg.evaluate("() => document.scrollingElement.scrollWidth")

        # ---------- the print-ready view (new tab) ----------
        try:
            with ctx.expect_page(timeout=6000) as np_info:
                pg.click("text=Print or save as PDF")
            np = np_info.value
            np.wait_for_timeout(1800)
            R["print_text"] = np.evaluate("""() => {
              const t = document.body.innerText;
              return ['Chelsea', 'Monthly receipt', 'Counted', 'Recorded', 'Intent', 'Licences held', 'never added together'].filter((s) => t.includes(s)).join('|');
            }""")
            np.screenshot(path=f"{OUT}/b96-print-desktop.png", full_page=True)
            np.close()
        except Exception as e:
            R["print_error"] = str(e)[:160]

        # ---------- Home -> rail "Your business page" (1 tap): the editor ----------
        pg.click(".tab-item[aria-label='Your business page']")
        pg.wait_for_timeout(1800)
        R["editor_present"] = pg.evaluate("() => !!document.getElementById('bp-availability')")
        pg.evaluate("() => { const el = document.getElementById('bp-availability'); if (el) el.scrollIntoView(); }")
        pg.wait_for_timeout(300)
        pg.screenshot(path=f"{OUT}/b96-availability-editor-desktop.png", full_page=False)
        # set Chelsea's shape through the real UI and save
        for d in ["Fri", "Sat", "Sun"]:
            try:
                pg.check(f"#bp-av-day-{d}", timeout=2500)
            except Exception:
                pg.evaluate(f"() => {{ const el = document.getElementById('bp-av-day-{d}'); el.checked = true; el.dispatchEvent(new Event('change', {{bubbles: true}})); }}")
        pg.fill("#bp-av-hours", "12 to 4")
        pg.fill("#bp-av-appointments", "Tue to Thu by appointment")
        pg.wait_for_timeout(300)
        R["live_card_line"] = pg.evaluate("() => { const el = document.querySelector('.bp-card-avail'); return el ? el.textContent : ''; }")
        pg.click("#bp-availability button")
        pg.wait_for_timeout(1200)
        R["saved_note"] = pg.evaluate("() => (document.getElementById('bp-ok-avail') || {}).textContent || ''")
        pg.screenshot(path=f"{OUT}/b96-availability-saved-desktop.png", full_page=False)

        # ---------- composer pre-fill (Campaigns, 1 tap from rail) ----------
        pg.click(".tab-item[aria-label='Campaigns']")
        pg.wait_for_timeout(2200)
        R["composer_window"] = pg.evaluate("() => { const el = document.getElementById('o2-window'); return el ? el.value : null; }")
        if R["composer_window"]:
            pg.evaluate("() => { const el = document.getElementById('o2-window'); if (el) el.scrollIntoView({block: 'center'}); }")
            pg.wait_for_timeout(300)
            pg.screenshot(path=f"{OUT}/b96-composer-desktop.png", full_page=False)

        # ---------- Sig serves the receipt in-thread ----------
        pg.click(".tab-item[aria-label='Sig']")
        pg.wait_for_timeout(2000)
        try:
            pg.click("button:has-text('Monthly receipt')", timeout=4000)
            pg.wait_for_timeout(1800)
            R["sig_receipt_thread"] = pg.evaluate("() => { const el = document.getElementById('sig-thread'); const t = el ? el.textContent : ''; return t.includes('Counted at the register') && t.includes('never added together') && t.includes('Download CSV'); }")
            pg.evaluate("() => { const el = document.getElementById('sig-thread'); if (el) el.scrollIntoView(); }")
            pg.wait_for_timeout(300)
        except Exception as e:
            R["sig_receipt_thread"] = f"walk failed: {str(e)[:100]}"
        pg.screenshot(path=f"{OUT}/b96-sig-desktop.png", full_page=False)
        ctx.close()

        # ---------- mobile 390px: Results export + editor ----------
        ctxm = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgm = ctxm.new_page()
        login(ctxm, "biz@b96qa.dev")
        pgm.goto(BASE + "/", wait_until="networkidle"); pgm.wait_for_timeout(2200)
        pgm.click(".tab-item[aria-label='Results']")
        pgm.wait_for_timeout(2500)
        R["mobile_export_present"] = pgm.evaluate("() => !!document.getElementById('receipt-export-card')")
        R["mobile_overflow"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        card = pgm.query_selector("#receipt-export-card")
        if card:
            card.screenshot(path=f"{OUT}/b96-results-mobile.png")
        pgm.click(".tab-item[aria-label='Your business page']")
        pgm.wait_for_timeout(1800)
        pgm.evaluate("() => { const el = document.getElementById('bp-availability'); if (el) el.scrollIntoView(); }")
        pgm.wait_for_timeout(300)
        R["mobile_editor_line"] = pgm.evaluate("() => { const el = document.querySelector('.bp-card-avail'); return el ? el.textContent : ''; }")
        pgm.screenshot(path=f"{OUT}/b96-availability-mobile.png", full_page=False)
        ctxm.close()

        # ---------- creator: the hours line on the offer board ----------
        ctxc = b.new_context(viewport={"width": 1280, "height": 900})
        pgc = ctxc.new_page()
        login(ctxc, "casey@b96qa.dev")
        pgc.goto(BASE + "/", wait_until="networkidle"); pgc.wait_for_timeout(2200)
        pgc.click(".tab-item[aria-label='Offers']")
        pgc.wait_for_timeout(2500)
        R["creator_line"] = pgc.evaluate("() => { const t = document.body.innerText; const i = t.indexOf('When you can come:'); return i >= 0 ? t.slice(i, i + 80) : ''; }")
        pgc.screenshot(path=f"{OUT}/b96-creator-offer-desktop.png", full_page=True)
        ctxc.close()
        b.close()
finally:
    server.terminate()

print(json.dumps(R, indent=1))
