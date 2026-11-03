#!/usr/bin/env python3
"""Build -87 Playwright QA: Settings switches (desktop + 390px,
creator + business) and the claim DONE install prompt."""
import os, sys, json, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/tier1-lanes/notify")
OUT = os.path.expanduser("~/workspace/research_notes/signl-audit-2026-11-01/fix-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 8971
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b87-qa-")
db = os.path.join(tmp, "db.json")

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE, ADMIN_EMAIL="admin@b87.dev", ADMIN_PASSWORD="<redacted>")
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

        def register(ctx, payload):
            r = ctx.request.post(BASE + "/api/auth/register", data=payload)
            return r.status

        def login(ctx, email):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": "qa-pass-1234"})
            return r.status

        # ---------- creator settings: desktop + mobile ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["creator_register"] = register(ctx, {"role": "creator", "quickClaim": True, "email": "qa-creator@b87.dev",
                                               "password": "qa-pass-1234", "market": "Nashville", "handle": "b87qa",
                                               "primaryPlatform": "instagram", "agreedTerms": True})
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(1200)
        pg.evaluate("""() => {
          document.getElementById('app').innerHTML = '<div class="wrap"><div id="tab-body"></div></div>';
          renderSettingsTab();
        }""")
        pg.wait_for_timeout(400)
        R["creator_switches"] = pg.evaluate("""() => ['np-offers','np-bookings','np-postclock','np-licences','np-applications','np-roster','np-phone']
          .map(id => { const e = document.getElementById(id); return e ? (e.type === 'tel' ? 'tel' : String(e.checked)) : 'MISSING'; }).join(',')""")
        R["creator_overflow_desktop"] = pg.evaluate("() => document.scrollingElement.scrollWidth")
        pg.screenshot(path=f"{OUT}/b87-settings-creator-desktop.png", full_page=True)
        # toggle postClock OFF and save via the real button (the
        # .sw switch styling intercepts pointer actionability, so
        # toggle with a DOM click on the real control itself)
        pg.evaluate("() => document.getElementById('np-postclock').click()")
        pg.evaluate("() => { const e = document.getElementById('np-phone'); e.value = '+15550007777'; }")
        R["creator_postclock_after_click"] = pg.evaluate("() => document.getElementById('np-postclock').checked")
        pg.click("text=Save notifications"); pg.wait_for_timeout(800)
        R["creator_saved_note"] = pg.evaluate("() => document.getElementById('np-ok').textContent")
        me = ctx.request.get(BASE + "/api/auth/me").json()["user"]
        R["creator_persisted"] = {"postClock": me["notifyPrefs"]["postClock"], "phone": me.get("phone")}
        ctx.close()

        ctxm = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgm = ctxm.new_page()
        login(ctxm, "qa-creator@b87.dev")
        pgm.goto(BASE + "/", wait_until="networkidle"); pgm.wait_for_timeout(1200)
        pgm.evaluate("""() => {
          document.getElementById('app').innerHTML = '<div class="wrap"><div id="tab-body"></div></div>';
          renderSettingsTab();
        }""")
        pgm.wait_for_timeout(400)
        R["mobile_postclock_state"] = pgm.evaluate("() => document.getElementById('np-postclock').checked")
        R["mobile_overflow"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        pgm.screenshot(path=f"{OUT}/b87-settings-creator-mobile.png", full_page=True)

        # ---------- claim DONE install prompt (mobile) ----------
        pgm.evaluate("""() => {
          try { localStorage.removeItem('signl_install_dismissed'); } catch (e) {}
          state.claimStep = 4;
          state.claimDone = { firstName: 'Casey', total: 1200, complete: true, under: false };
          renderClaimDone();
        }""")
        pgm.wait_for_timeout(400)
        R["install_banner_visible"] = pgm.evaluate("() => !!document.getElementById('signl-install-banner')")
        R["claim_done_overflow"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        pgm.screenshot(path=f"{OUT}/b87-claim-done-install-mobile.png", full_page=True)
        pgm.click("#signl-install-banner a"); pgm.wait_for_timeout(300)
        R["install_banner_dismissed"] = pgm.evaluate("() => !document.getElementById('signl-install-banner') && localStorage.getItem('signl_install_dismissed') === '1'")
        ctxm.close()

        # ---------- business settings: desktop (left rail intact) ----------
        ctxb = b.new_context(viewport={"width": 1280, "height": 900})
        pgb = ctxb.new_page()
        R["business_register"] = register(ctxb, {"role": "business", "name": "Biz Owner", "email": "qa-biz@b87.dev", "password": "qa-pass-1234",
                                                 "market": "Nashville", "businessName": "B87 QA Bistro", "plan": "growth",
                                                 "category": "Restaurant", "neighborhood": "Midtown", "about": "Counter service.", "agreedTerms": True})
        pgb.goto(BASE + "/", wait_until="networkidle"); pgb.wait_for_timeout(1500)
        pgb.evaluate("""() => {
          const tb = document.getElementById('tab-body');
          if (!tb) { document.getElementById('app').innerHTML = '<div class="wrap"><div id="tab-body"></div></div>'; }
          renderSettingsTab();
        }""")
        pgb.wait_for_timeout(600)
        R["business_switches"] = pgb.evaluate("""() => ['np-offers','np-postclock','np-applications','np-roster']
          .map(id => { const e = document.getElementById(id); return e ? String(e.checked) : 'MISSING'; }).join(',')""")
        R["business_rail_present"] = pgb.evaluate("() => { const r = document.getElementById('rail'); return !!r && r.children.length > 0; }")
        R["business_overflow_desktop"] = pgb.evaluate("() => document.scrollingElement.scrollWidth")
        pgb.screenshot(path=f"{OUT}/b87-settings-business-desktop.png", full_page=True)
        ctxb.close()
        b.close()
finally:
    server.terminate()

print(json.dumps(R, indent=1))
