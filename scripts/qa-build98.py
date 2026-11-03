#!/usr/bin/env python3
"""Build -98 Playwright QA: claim done block, rate starting
defaults, payout explainer.

Desktop + 390px. Claim done is rendered through the shipped
renderClaimDone() with a done-state readout (the Build -87 QA
pattern). Profile shots use three seeded creators: blank
rates (defaults pre-fill), set rates (no defaults, no starting
line), and a rate set with payouts not started (explainer)."""
import os, sys, json, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-audit-2026-11-01/fix-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 8989
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b98-qa-")
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
const creator = (id, email, creatorOver) => putUser({ id, role: "creator", email, name: "Casey " + id, passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), creator: Object.assign({ handle: id, followerCount: 3000, totalAudience: 3000, audienceStack: { instagram: 3000 }, categories: ["Food & Drink"], localAudiencePct: 70, tierBand: "Locals", profileComplete: true }, creatorOver || {}) });
creator("crblank", "blank@b98qa.dev", {});
creator("crset", "set@b98qa.dev", { paidRate: 500, licensingFee: 200, tierBand: "Headliners", followerCount: 22000, totalAudience: 22000, audienceStack: { instagram: 22000 } });
creator("crpay", "pay@b98qa.dev", { paidRate: 250 });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE,
           ADMIN_EMAIL="admin@b98.dev", ADMIN_PASSWORD="b98-admin-pass-123")
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

        def lane_shot(pg, name):
            pg.evaluate("""() => {
              const row = document.getElementById('lane-rate-row'); if (row) row.style.display = 'block';
            }""")
            pg.wait_for_timeout(400)
            pg.locator("#lane-controls").screenshot(path=f"{OUT}/{name}")

        # ---------- desktop: claim done ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(1500)
        pg.evaluate("""() => {
          state.claimStep = 4;
          state.claimDone = { firstName: 'Casey', total: 3200, complete: true, under: false };
          renderClaimDone();
        }""")
        pg.wait_for_timeout(600)
        R["claim_block"] = pg.evaluate("""() => { const el = document.getElementById('claim-what-you-get'); return el ? el.innerText : ''; }""")
        R["claim_overflow"] = pg.evaluate("() => document.scrollingElement.scrollWidth")
        pg.screenshot(path=f"{OUT}/b98-claim-done-desktop.png", full_page=False)
        ctx.close()

        # ---------- desktop: blank-rate creator ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["login_blank"] = login(ctx, "blank@b98qa.dev")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2200)
        pg.evaluate("() => go('dashboard','Profile')"); pg.wait_for_timeout(1800)
        R["blank_defaults"] = pg.evaluate("""() => ({
          starting: (document.getElementById('lane-starting-line') || {}).innerText || '',
          rate: (document.getElementById('lane-rate') || {}).value || '',
          fee: (document.getElementById('lane-fee') || {}).value || ''
        })""")
        lane_shot(pg, "b98-rates-blank-desktop.png")
        R["blank_overflow"] = pg.evaluate("() => document.scrollingElement.scrollWidth")
        ctx.close()

        # ---------- desktop: set-rate creator ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["login_set"] = login(ctx, "set@b98qa.dev")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2200)
        pg.evaluate("() => go('dashboard','Profile')"); pg.wait_for_timeout(1800)
        R["set_rates"] = pg.evaluate("""() => ({
          starting: (document.getElementById('lane-starting-line') || {}).innerText || '',
          rate: (document.getElementById('lane-rate') || {}).value || '',
          fee: (document.getElementById('lane-fee') || {}).value || ''
        })""")
        lane_shot(pg, "b98-rates-set-desktop.png")
        ctx.close()

        # ---------- desktop: payout explainer ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["login_pay"] = login(ctx, "pay@b98qa.dev")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2200)
        pg.evaluate("() => go('dashboard','Profile')"); pg.wait_for_timeout(1800)
        R["explainer"] = pg.evaluate("""() => { const el = document.getElementById('payout-explainer'); return el ? el.innerText.slice(0, 220) : ''; }""")
        pg.wait_for_timeout(400)
        pg.locator(".lane-payouts").screenshot(path=f"{OUT}/b98-payout-explainer-desktop.png")
        ctx.close()

        # ---------- mobile 390px ----------
        ctxm = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgm = ctxm.new_page()
        pgm.goto(BASE + "/", wait_until="networkidle"); pgm.wait_for_timeout(1500)
        pgm.evaluate("""() => {
          state.claimStep = 4;
          state.claimDone = { firstName: 'Casey', total: 3200, complete: true, under: false };
          renderClaimDone();
        }""")
        pgm.wait_for_timeout(600)
        R["mobile_claim_block"] = pgm.evaluate("() => !!document.getElementById('claim-what-you-get')")
        R["mobile_claim_overflow"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        pgm.screenshot(path=f"{OUT}/b98-claim-done-mobile.png", full_page=False)
        ctxm.close()

        ctxm = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgm = ctxm.new_page()
        login(ctxm, "blank@b98qa.dev")
        pgm.goto(BASE + "/", wait_until="networkidle"); pgm.wait_for_timeout(2200)
        pgm.evaluate("() => go('dashboard','Profile')"); pgm.wait_for_timeout(1800)
        R["mobile_blank_rate"] = pgm.evaluate("() => (document.getElementById('lane-rate') || {}).value || ''")
        lane_shot(pgm, "b98-rates-blank-mobile.png")
        R["mobile_blank_overflow"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        ctxm.close()

        ctxm = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgm = ctxm.new_page()
        login(ctxm, "pay@b98qa.dev")
        pgm.goto(BASE + "/", wait_until="networkidle"); pgm.wait_for_timeout(2200)
        pgm.evaluate("() => go('dashboard','Profile')"); pgm.wait_for_timeout(1800)
        R["mobile_explainer"] = pgm.evaluate("() => !!document.getElementById('payout-explainer')")
        pgm.wait_for_timeout(400)
        pgm.locator(".lane-payouts").screenshot(path=f"{OUT}/b98-payout-explainer-mobile.png")
        R["mobile_pay_overflow"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        ctxm.close()
        b.close()
finally:
    server.terminate()

print(json.dumps(R, indent=1))
