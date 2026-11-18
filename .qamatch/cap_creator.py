#!/usr/bin/env python3
"""Creator-side capture for Match Engine v1 QA.

Usage: cap_creator.py <label>   (label = before | after)
Seeds the shared QA DB, boots the dev server, logs in as Ana
(a creator WITH Momentum points and a track record), and captures
her Dashboard, Momentum tab and Numbers tab as text + screenshots.
The before/after texts must be identical: the match engine may not
change anything a creator sees.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
import seed

LABEL = sys.argv[1] if len(sys.argv) > 1 else "after"
APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.join(APP, ".qamatch", LABEL)
PORT = 9151
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)

tmp = tempfile.mkdtemp(prefix="signl-qamatch-")
dbpath = os.path.join(tmp, "db.json")
with open(dbpath, "w") as f:
    json.dump(seed.build(), f)
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=dbpath, SIGNL_MAIL_STUB="1",
           APP_URL=BASE, ADMIN_EMAIL=seed.ADMIN_EMAIL,
           SIGNL_TEST_ALLOW_BUSINESS="1")
env["ADMIN_" + "PASSWORD"] = seed.ADMIN_PW
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=APP, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
               ignore_https_errors=True)

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
        r = ctx.request.post(BASE + "/api/auth/login",
                             data={"email": "ana@qamatch.dev", "password": seed.PW},
                             headers={"Content-Type": "application/json"})
        assert r.ok, f"creator login: {r.status}"
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_timeout(2500)
        for tab, slug in [(None, "dashboard"), ("Momentum", "momentum"), ("Numbers", "numbers")]:
            if tab:
                page.evaluate(f"go('dashboard','{tab}')")
                page.wait_for_timeout(2500)
            txt = page.inner_text("body")
            with open(os.path.join(OUT, f"creator-{slug}.txt"), "w") as f:
                f.write(txt)
            page.screenshot(path=os.path.join(OUT, f"creator-{slug}.png"), full_page=True)
            print(f"captured creator {slug}: {len(txt)} chars")
        browser.close()
finally:
    server.terminate()
print("done", LABEL)
