#!/usr/bin/env python3
"""Build -110 (Phase A) Playwright QA:
- Admin: Applications queue renders with ZERO demo UI (desktop +
  390px); Admin -> Requests (1 rail tap) hosts the Demo showcase
  Load/Remove panel.
- Business: Posts & licenses carries "Extend or license
  separately" on the paid post's row; the paid visit card carries
  the included-licence line + the extension action.
Desktop 1280 + mobile 390px, overflow checked."""
import os, sys, json, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-phase-a-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 8989
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b110-qa-")
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
putUser({ id: "bizqa", role: "business", email: "biz@b110qa.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), phone: "+15550001111", business: { businessName: "B110 QA Bistro", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Counter service tacos and brunch." } });
putUser({ id: "crqa", role: "creator", email: "casey@b110qa.dev", name: "Casey Creator", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), creator: { handle: "b110casey", followerCount: 3000, categories: ["Food & Drink"], localAudiencePct: 70, paidRate: 200, licensingFee: 80, tierBand: "Locals" } });
data["booking:bkpaid"] = { id: "bkpaid", offerId: null, businessId: "bizqa", businessName: "B110 QA Bistro", creatorId: "crqa", creatorName: "Casey Creator", creatorHandle: "b110casey", market: "Nashville", category: "Restaurant", kind: "paid", title: "Paid dinner", whatComped: "Tasting menu for two", covers: 2, dollarCap: 200, status: "completed", code: "B110PAID", codeStatus: "burned", redeemedAt: iso(now0 - 9 * DAY), postDeadline: iso(now0 - 7 * DAY), createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 8 * DAY), redemptions: null, paidLane: { rate: 200, businessTotal: 206, creatorNet: 194, platformFee: 12, licenseDays: 90, licenseNote: "Standard license included: repost + ad use for 90 days from the post date, never longer.", escrowState: "released", paymentNote: "Recorded, no card charged.", bookedAt: iso(now0 - 10 * DAY), proofAt: iso(now0 - 8 * DAY), releasedAt: iso(now0 - 6 * DAY) } };
data["post:ppaid"] = { id: "ppaid", bookingId: "bkpaid", businessId: "bizqa", creatorId: "crqa", url: "https://www.instagram.com/p/b110paid/", createdAt: iso(now0 - 8 * DAY), submittedAt: iso(now0 - 8 * DAY), reportedAt: iso(now0 - 8 * DAY), views: 4200, likes: 260, shares: 30, saves: 44, onTime: true, standardLicence: { recordId: "std-bkpaid", startsAt: iso(now0 - 8 * DAY), windowEndsAt: iso(now0 + 82 * DAY) } };
data["stdlicence:std-bkpaid"] = { id: "std-bkpaid", type: "standard", included: true, autoCreated: true, status: "granted", postId: "ppaid", bookingId: "bkpaid", businessId: "bizqa", businessName: "B110 QA Bistro", creatorId: "crqa", creatorHandle: "b110casey", fee: 0, licenseDays: 90, startsAt: iso(now0 - 8 * DAY), windowEndsAt: iso(now0 + 82 * DAY), createdAt: iso(now0 - 8 * DAY), note: "Included with this paid booking: repost + paid ad use for 90 days from the post date, never longer." };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE, ADMIN_EMAIL="admin@b110.dev", ADMIN_PASSWORD="qa-admin-pass-110")
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

        # ---------- ADMIN desktop: Applications has ZERO demo UI ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["admin_login"] = login(ctx, "admin@b110.dev", "qa-admin-pass-110")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2200)
        R["applications_zero_demo"] = pg.evaluate("""() => {
          const t = document.body.innerText;
          return !t.includes('Demo showcase') && !t.includes('Load Nashville demo creators') && !document.getElementById('admin-demo-showcase');
        }""")
        pg.screenshot(path=f"{OUT}/b110-admin-applications-desktop.png", full_page=True)
        # ONE rail tap: Admin -> Requests -> Demo showcase
        click_nav(pg, "Requests")
        pg.wait_for_timeout(1800)
        R["requests_has_demo_showcase"] = pg.evaluate("""() => {
          const t = document.body.innerText;
          const host = document.getElementById('admin-demo-showcase');
          return t.includes('Demo showcase: Nashville creators') && !!host && t.includes('Load Nashville demo creators');
        }""")
        R["admin_requests_overflow"] = pg.evaluate("() => document.scrollingElement.scrollWidth")
        pg.screenshot(path=f"{OUT}/b110-admin-requests-desktop.png", full_page=True)
        ctx.close()

        # ---------- ADMIN mobile 390 ----------
        ctxm = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgm = ctxm.new_page()
        login(ctxm, "admin@b110.dev", "qa-admin-pass-110")
        pgm.goto(BASE + "/", wait_until="networkidle"); pgm.wait_for_timeout(2200)
        R["mobile_applications_zero_demo"] = pgm.evaluate("() => !document.body.innerText.includes('Demo showcase') && !document.getElementById('admin-demo-showcase')")
        click_nav(pgm, "Requests")
        pgm.wait_for_timeout(1800)
        R["mobile_requests_demo"] = pgm.evaluate("() => document.body.innerText.includes('Demo showcase: Nashville creators')")
        R["mobile_admin_overflow"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        pgm.screenshot(path=f"{OUT}/b110-admin-requests-mobile.png", full_page=True)
        ctxm.close()

        # ---------- BUSINESS desktop: Content + visit card ----------
        ctxb = b.new_context(viewport={"width": 1280, "height": 900})
        pgb = ctxb.new_page()
        R["biz_login"] = login(ctxb, "biz@b110qa.dev")
        pgb.goto(BASE + "/", wait_until="networkidle"); pgb.wait_for_timeout(2000)
        click_nav(pgb, "Posts & licenses")
        pgb.wait_for_timeout(1800)
        R["content_extend_action"] = pgb.evaluate("() => document.body.innerText.includes('Extend or license separately')")
        R["content_std_window_line"] = pgb.evaluate("() => document.body.innerText.includes('Standard license')")
        R["biz_content_overflow"] = pgb.evaluate("() => document.scrollingElement.scrollWidth")
        pgb.screenshot(path=f"{OUT}/b110-biz-content-desktop.png", full_page=True)
        click_nav(pgb, "Visits")
        pgb.wait_for_timeout(1800)
        R["visitcard_included_line"] = pgb.evaluate("() => document.body.innerText.includes('This booking includes the standard license: repost and ad use for 90 days from the post date, never longer.')")
        R["visitcard_extend_action"] = pgb.evaluate("() => document.body.innerText.includes('Extend or license separately')")
        pgb.screenshot(path=f"{OUT}/b110-biz-visitcard-desktop.png", full_page=True)
        ctxb.close()

        # ---------- BUSINESS mobile 390 ----------
        ctxmb = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgmb = ctxmb.new_page()
        login(ctxmb, "biz@b110qa.dev")
        pgmb.goto(BASE + "/", wait_until="networkidle"); pgmb.wait_for_timeout(2000)
        click_nav(pgmb, "Posts & licenses")
        pgmb.wait_for_timeout(1800)
        R["mobile_content_extend"] = pgmb.evaluate("() => document.body.innerText.includes('Extend or license separately')")
        R["mobile_biz_overflow"] = pgmb.evaluate("() => document.scrollingElement.scrollWidth")
        pgmb.screenshot(path=f"{OUT}/b110-biz-content-mobile.png", full_page=True)
        ctxmb.close()
        b.close()
finally:
    server.terminate()

print(json.dumps(R, indent=1))
