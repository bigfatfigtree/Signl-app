#!/usr/bin/env python3
import json, os, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Reuse the QA fixture by importing its data block is overkill; build a minimal one.
import base64
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
PORT = 9142
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
c = {"handle": "tesstester", "platform": "Instagram", "handleNormalized": "tesstester", "city": "Nashville",
     "categories": ["Food & Drink"], "tierBand": "Locals", "compCategories": ["Restaurant meals"],
     "audienceStack": {"instagram": 8000}, "totalAudience": 8000, "followerCount": 8000,
     "localAudiencePct": 80, "paidRate": 150, "compOpen": True, "couponOpen": True,
     "profileComplete": True, "publicPage": True, "bio": "Tess.", "audienceMarkets": []}
data["user:crtester"] = {"id": "crtester", "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
    "createdAt": "2026-09-01T00:00:00.000Z", "tester": True, "role": "creator", "email": "hello@xmedium.co",
    "name": "Tess Tester", "city": "Nashville", "market": "Nashville", "creator": c}
for uid in ["bizsalt", "crtester"]:
    data[f"email:{data['user:'+uid]['email']}"] = {"userId": uid}
tmp = tempfile.mkdtemp(prefix="signl-probe-")
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
            import urllib.request
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        actx = browser.new_context(**CTXOPTS)
        r = actx.request.post(BASE + "/api/auth/login", data={"email": "admin@qa140.dev", "password": "qa140-admin-pass"}, headers={"Content-Type": "application/json"})
        assert r.ok
        r = actx.request.post(BASE + "/api/admin/test-offers/load", data={}, headers={"Content-Type": "application/json"})
        print("seed:", r.status, r.json().get("result", {}).get("created"))
        ctx = browser.new_context(viewport={"width": 1875, "height": 949}, **CTXOPTS)
        r = ctx.request.post(BASE + "/api/auth/login", data={"email": "hello@xmedium.co", "password": PW}, headers={"Content-Type": "application/json"})
        assert r.ok
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.evaluate("go('dashboard','Find Offers')")
        page.wait_for_selector("#fo-rail", timeout=15000)
        page.wait_for_selector(".mirror-card", timeout=15000)
        page.wait_for_timeout(600)
        info = page.evaluate("""() => { const r = document.querySelector('#fo-rail');
          const kids = [...r.children].map(el => ({ cls: el.className, h: Math.round(el.getBoundingClientRect().height), label: (el.querySelector('.df-label') || {}).innerText || '' }));
          return { scrollH: r.scrollHeight, clientH: r.clientHeight, kids,
                   radios: [...r.querySelectorAll('input')].map(i => i.type + ':' + i.name + '=' + i.value).slice(0, 30),
                   tailHtml: r.innerHTML.slice(-600) }; }""")
        print(json.dumps(info, indent=1)[:2600])
        scrolled = page.evaluate("""() => { const r = document.querySelector('#fo-rail'); r.scrollTop = r.scrollHeight;
          const kids = [...r.children]; const last = kids[kids.length - 1];
          const rr = r.getBoundingClientRect(); const lr = last.getBoundingClientRect();
          return { lastCls: last.className, lastTop: Math.round(lr.top), lastBottom: Math.round(lr.bottom), railTop: Math.round(rr.top), railBottom: Math.round(rr.bottom), scrollY: window.scrollY }; }""")
        print("after scroll:", json.dumps(scrolled))
        browser.close()
finally:
    server.kill()
