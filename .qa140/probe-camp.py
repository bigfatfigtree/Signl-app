#!/usr/bin/env python3
import json, os, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright
APP = os.path.expanduser("~/workspace/signl-app")
PORT = 9145
BASE = f"http://127.0.0.1:{PORT}"
PW, SALT = "qa-pass-140", "qa140salt"
HASH = subprocess.run(["node", "-e",
    "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
    PW, SALT], capture_output=True, text=True, check=True).stdout.strip()
data = {}
data["user:bizsalt"] = {"id": "bizsalt", "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
    "createdAt": "2026-09-01T00:00:00.000Z", "tester": True, "role": "business", "email": "saltline@qa140.dev",
    "name": "Salt Line Owner", "market": "Nashville",
    "business": {"businessName": "Salt Line Test Kitchen", "legalName": "SLTK LLC", "category": "Restaurant",
                 "address": "100 Union St", "city": "Nashville", "state": "TN", "zip": "37201",
                 "neighborhood": "Downtown", "phone": "6155550100", "website": ""},
    "businessOnboarded": True, "subscription": {"tier": "growth", "status": "founding", "credits": 10}}
data["email:saltline@qa140.dev"] = {"userId": "bizsalt"}
tmp = tempfile.mkdtemp(prefix="signl-probe4-")
dbpath = os.path.join(tmp, "db.json")
with open(dbpath, "w") as f: json.dump(data, f)
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=dbpath, SIGNL_MAIL_STUB="1", APP_URL=BASE,
           ADMIN_EMAIL="admin@qa140.dev", ADMIN_PASSWORD="qa140-admin-pass", SIGNL_TEST_ALLOW_BUSINESS="1")
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=APP, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"}, ignore_https_errors=True)
try:
    for i in range(120):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 760}, **CTXOPTS)
        r = ctx.request.post(BASE + "/api/auth/login", data={"email": "saltline@qa140.dev", "password": PW}, headers={"Content-Type": "application/json"})
        assert r.ok
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector(".hl137-num", timeout=15000)
        page.evaluate("go('dashboard','Campaign Setup')")
        page.wait_for_selector(".camp-rail", timeout=15000)
        page.wait_for_timeout(700)
        out = page.evaluate("""() => { const rails = [...document.querySelectorAll('.camp-rail')];
          const info = rails.map((r, i) => ({ i, top: Math.round(r.getBoundingClientRect().top), sh: r.scrollHeight, ch: r.clientHeight,
            kids: [...r.children].map(k => k.className + '|' + Math.round(k.getBoundingClientRect().height)) }));
          const r = rails[0]; r.scrollTop = r.scrollHeight;
          const picks = [...r.querySelectorAll('.camp-pick')].map(el => { const b = el.getBoundingClientRect();
            let chain = []; let n = el; for (let d = 0; d < 5 && n; d++) { chain.push(n.className || n.tagName); n = n.offsetParent; }
            return { t: el.innerText.slice(0, 22), top: Math.round(b.top), bottom: Math.round(b.bottom), pos: getComputedStyle(el).position, chain }; });
          return { rails: info, scrollTopAfter: r.scrollTop, picks }; }""")
        print(json.dumps(out, indent=1)[:3400])
        browser.close()
finally:
    server.kill()
