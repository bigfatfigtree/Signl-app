#!/usr/bin/env python3
import json, os, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright
APP = os.path.expanduser("~/workspace/signl-app")
PORT = 9144
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
def creator(uid, email, name, handle, market, city, pct, stack, cats, **kw):
    c = {"handle": handle, "platform": "Instagram", "handleNormalized": handle, "city": city,
         "categories": cats, "tierBand": "Locals", "compCategories": cats,
         "audienceStack": stack, "totalAudience": sum(stack.values()), "followerCount": sum(stack.values()),
         "localAudiencePct": pct, "paidRate": 150, "compOpen": True, "couponOpen": True,
         "profileComplete": True, "publicPage": True, "bio": name + " — local creator.",
         "localAudienceSource": "Self-reported"}
    c.update(kw.pop("cextra", {}))
    return {"id": uid, "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
            "createdAt": "2026-09-01T00:00:00.000Z", "tester": True, "role": "creator", "email": email,
            "name": name, "city": city, "market": market, "creator": c, **kw}
# Fred: NO audienceMarkets key at all, localAudiencePct null
data["user:crfred"] = creator("crfred", "fred@qa140.dev", "Fred Fresh", "fredfresh", "Nashville", "Nashville", None,
    {"instagram": 8000}, ["Food & Drink"],
    cextra={"tierBand": "Neighbors", "instagramUrl": "https://instagram.com/fredfresh"})
data["email:fred@qa140.dev"] = {"userId": "crfred"}
tmp = tempfile.mkdtemp(prefix="signl-probe3-")
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
        # ---- Fred flow with response capture
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, **CTXOPTS)
        r = ctx.request.post(BASE + "/api/auth/login", data={"email": "fred@qa140.dev", "password": PW}, headers={"Content-Type": "application/json"})
        assert r.ok
        page = ctx.new_page()
        patches = []
        def on_resp(resp):
            if "/api/me/profile" in resp.url and resp.request.method == "PATCH":
                try: patches.append(resp.json())
                except Exception: patches.append({"_unreadable": resp.status})
        page.on("response", on_resp)
        errs = []
        page.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)[:300]))
        page.on("console", lambda m: errs.append("CONSOLE " + m.type + ": " + m.text[:200]) if m.type in ("error", "warning") else None)
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector("#sigtop-nudges", timeout=15000)
        page.wait_for_timeout(400)
        r = page.evaluate("try { go('dashboard','Profile'); 'ok' } catch (e) { 'THREW: ' + e.message }")
        print("go(dashboard,Profile) ->", r)
        page.wait_for_selector("#pf-audience", timeout=15000)
        page.wait_for_timeout(400)
        has_splits_input = page.evaluate("!!document.querySelector('#pf-audience [data-amkt], #pf-audience input[name*=market i], #p-audiencemarkets') || [...document.querySelectorAll('#pf-audience input, #pf-audience textarea')].map(e => e.id || e.name || e.placeholder)")
        print("audience inputs:", json.dumps(has_splits_input)[:400])
        page.select_option("#p-add-platform", "twitch")
        page.click("text=Add platform")
        page.wait_for_timeout(400)
        page.fill("#p-stack-twitch", "1500")
        page.fill("#p-lp-instagram", "82")
        page.click(".save-bar button[type='submit']")
        page.wait_for_timeout(1800)
        for pj in patches:
            print("PATCH keys:", sorted(pj.keys()), "| geoAward:", pj.get("geoAward"), "| localRateAwards:", pj.get("localRateAwards"))
            uc = (pj.get("user") or {}).get("creator") or {}
            print("PATCH user.creator:", json.dumps({k: uc.get(k) for k in ["audienceMarkets", "platformLocalPct", "localAudiencePct"]}))
        print("typeof toast:", page.evaluate("typeof toast"), "| typeof showToast:", page.evaluate("typeof showToast"))
        print("toast src:", page.evaluate("typeof toast === 'function' ? String(toast).slice(0, 140) : 'n/a'"))
        page.evaluate("toast('PROBE TOAST +10 Momentum audience breakdown complete')")
        page.wait_for_timeout(400)
        print("manual toast in body text:", "PROBE TOAST" in page.inner_text("body"),
              "| toast el:", page.evaluate("(() => { const t = document.getElementById('signl-toast'); return t ? { cls: t.className, txt: t.innerText } : null; })()"))
        seen = False
        for i in range(24):
            t = page.inner_text("body")
            if "+10 Momentum" in t and "audience breakdown complete" in t:
                seen = True; break
            page.wait_for_timeout(250)
        print("toast seen within 6s:", seen, "| pageerrors:", errs[:3])
        print("save-ok element:", page.evaluate("!!document.getElementById('save-ok')"), "| save-ok text:", page.evaluate("(document.getElementById('save-ok') || {}).textContent"))
        # ---- campaign rail probe
        bctx = browser.new_context(viewport={"width": 1440, "height": 760}, **CTXOPTS)
        r = bctx.request.post(BASE + "/api/auth/login", data={"email": "saltline@qa140.dev", "password": PW}, headers={"Content-Type": "application/json"})
        assert r.ok
        bp = bctx.new_page()
        bp.goto(BASE + "/", wait_until="networkidle")
        bp.evaluate("go('campaign')")
        bp.wait_for_selector(".camp-rail", timeout=15000)
        bp.wait_for_timeout(600)
        info = bp.evaluate("""() => { const r = document.querySelector('.camp-rail');
          const kids = [...r.querySelectorAll('.camp-pick')].map(el => ({ t: el.innerText.slice(0, 24), h: Math.round(el.getBoundingClientRect().height) }));
          r.scrollTop = r.scrollHeight;
          const picks = [...r.querySelectorAll('.camp-pick')].filter(g => g.getBoundingClientRect().height > 0);
          const last = picks[picks.length - 1]; const rr = r.getBoundingClientRect(); const lr = last.getBoundingClientRect();
          return { scrollH: r.scrollHeight, clientH: r.clientHeight, nPicks: kids.length, kids: kids.slice(-4),
                   lastText: last.innerText.slice(0, 30), lastTop: Math.round(lr.top), lastBottom: Math.round(lr.bottom),
                   railTop: Math.round(rr.top), railBottom: Math.round(rr.bottom) }; }""")
        print("campaign rail:", json.dumps(info, indent=1))
        browser.close()
finally:
    server.kill()
