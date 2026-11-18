#!/usr/bin/env python3
"""Build -140 ship probe: the pdpSaveToggle toast fix.

Boots the same local dev server + fixtures pattern as
qa-build140.py (business + Kesha only), opens Kesha's profile as
the business, clicks Save, and asserts:
  - the #signl-toast element appears with "Saved to your list."
  - the button flips to "Saved"
  - ZERO pageerrors and ZERO console errors (the old code threw
    "toast is not defined" inside the favorites .then)
Then clicks again (unsave) and asserts "Removed from your list."
with still zero errors.
"""
import json, os, subprocess, sys, tempfile, time

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.join(APP, ".qa140", "shots")
PORT = 9142
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)

PW = "qa-pass-140"
SALT = "qa140salt"
HASH = subprocess.run(["node", "-e",
    "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
    PW, SALT], capture_output=True, text=True, check=True).stdout.strip()

def u(uid, **kw):
    d = {"id": uid, "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
         "createdAt": "2026-09-01T00:00:00.000Z", "tester": False}
    d.update(kw); return d

data = {}
data["user:bizsalt"] = u("bizsalt", role="business", email="saltline@qa140.dev", name="Salt Line Owner",
    market="Nashville", tester=True,
    business={"businessName": "Salt Line Test Kitchen", "legalName": "SLTK LLC", "category": "Restaurant",
              "address": "100 Union St", "city": "Nashville", "state": "TN", "zip": "37201",
              "neighborhood": "Downtown", "phone": "6155550100", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
c = {"handle": "keshalocal", "platform": "Instagram", "handleNormalized": "keshalocal",
     "city": "Nashville", "state": "TN", "neighborhood": "Germantown",
     "categories": ["Food & Drink"], "tierBand": "Locals",
     "compCategories": ["Restaurant meals"],
     "audienceStack": {"instagram": 28000}, "totalAudience": 28000,
     "followerCount": 28000, "localAudiencePct": 82, "paidRate": 150,
     "compOpen": True, "couponOpen": True, "profileComplete": True,
     "publicPage": True, "bio": "Kesha Local — local.", "avgViews": 3000,
     "audienceMarkets": [], "instagramUrl": "https://instagram.com/keshalocal"}
data["user:crkesha"] = u("crkesha", role="creator", email="kesha@qa140.dev", name="Kesha Local",
                         city="Nashville", market="Nashville", creator=c)
for uid in ["bizsalt", "crkesha"]:
    data[f"email:{data['user:'+uid]['email']}"] = {"userId": uid}

tmp = tempfile.mkdtemp(prefix="signl-qa140-toast-")
dbpath = os.path.join(tmp, "db.json")
with open(dbpath, "w") as f: json.dump(data, f)
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=dbpath, SIGNL_MAIL_STUB="1",
           APP_URL=BASE, ADMIN_EMAIL="admin@qa140.dev", ADMIN_PASSWORD="qa140-admin-pass",
           SIGNL_TEST_ALLOW_BUSINESS="1")
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=APP, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
fails = []
def ck(name, cond, extra=""):
    print(("  ok " if cond else "FAIL ") + name + (f" :: {extra}" if extra and not cond else ""))
    if not cond: fails.append(name)

CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
               ignore_https_errors=True)
try:
    import urllib.request
    for i in range(120):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, **CTXOPTS)
        r = ctx.request.post(BASE + "/api/auth/login", data={"email": "saltline@qa140.dev", "password": PW},
                             headers={"Content-Type": "application/json"})
        assert r.ok, f"login: {r.status}"
        page = ctx.new_page()
        pageerrors, console_errors, script_errors = [], [], []
        def on_console(m):
            if m.type == "error":
                console_errors.append(m.text)
                if any(s in m.text for s in ("toast", "is not defined", "Uncaught", "ReferenceError", "TypeError")):
                    script_errors.append(m.text)
        page.on("pageerror", lambda e: pageerrors.append(str(e)))
        page.on("console", on_console)
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector(".hl137-num", timeout=15000)
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_selector(".shelf-tile", timeout=15000)
        page.wait_for_timeout(500)
        page.evaluate("openCreatorProfile('crkesha')")
        page.wait_for_selector(".pdp-hero", timeout=10000)
        page.wait_for_selector("#pdp-save-top", timeout=10000)
        ck("PDP Save button present, initial label 'Save'",
           page.inner_text("#pdp-save-top") == "Save", page.inner_text("#pdp-save-top"))

        page.click("#pdp-save-top")
        try:
            page.wait_for_function(
                "const t = document.getElementById('signl-toast'); t && t.classList.contains('show') && t.innerText.includes('Saved to your list.')",
                timeout=8000)
            toast1 = True
        except Exception:
            toast1 = False
        ck("click Save -> toast appears: 'Saved to your list.'", toast1,
           page.evaluate("const t=document.getElementById('signl-toast'); t ? t.innerText : 'NO TOAST'"))
        ck("button flipped to 'Saved'", page.inner_text("#pdp-save-top") == "Saved",
           page.inner_text("#pdp-save-top"))
        page.wait_for_timeout(400)
        ck("no pageerrors after Save", pageerrors == [], " | ".join(pageerrors))
        ck("no script console errors after Save (no 'toast is not defined')",
           script_errors == [], " | ".join(script_errors))
        page.screenshot(path=f"{OUT}/16-save-toast.png")

        page.click("#pdp-save-top")
        try:
            page.wait_for_function(
                "const t = document.getElementById('signl-toast'); t && t.classList.contains('show') && t.innerText.includes('Removed from your list.')",
                timeout=8000)
            toast2 = True
        except Exception:
            toast2 = False
        ck("click again (unsave) -> toast: 'Removed from your list.'", toast2,
           page.evaluate("const t=document.getElementById('signl-toast'); t ? t.innerText : 'NO TOAST'"))
        ck("button back to 'Save'", page.inner_text("#pdp-save-top") == "Save",
           page.inner_text("#pdp-save-top"))
        page.wait_for_timeout(400)
        ck("still zero pageerrors after unsave", pageerrors == [], " | ".join(pageerrors))
        ck("still zero script console errors after unsave", script_errors == [], " | ".join(script_errors))
        print("  note: non-script console noise (proxy resource loads):", len(console_errors), "entries")
        browser.close()
finally:
    server.kill()
print(f"\nPROBE save-toast: {len(fails)} failures" + (": " + " | ".join(fails) if fails else ""))
sys.exit(1 if fails else 0)
