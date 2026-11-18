#!/usr/bin/env python3
"""Diagnostic: why doesn't the Find offers rail scroll independently?
Measures #fo-rail (creator) and #disc-rail (business) geometry,
computed styles, ancestor chain, and wheel behavior."""
import json, os, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
PORT = 9140
BASE = f"http://127.0.0.1:{PORT}"
PW, SALT = "qa-pass-139", "qa139salt"
HASH = subprocess.run(["node", "-e",
    "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
    PW, SALT], capture_output=True, text=True, check=True).stdout.strip()
ADMIN_EMAIL, ADMIN_PW = "admin@qa139.dev", "qa139-admin-pass"

def u(uid, **kw):
    d = {"id": uid, "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
         "createdAt": "2026-09-01T00:00:00.000Z", "tester": False}
    d.update(kw); return d

def creator(uid, email, name, handle, pct, total, cats, extra=None):
    c = {"handle": handle, "platform": "Instagram", "handleNormalized": handle,
         "market": "Nashville", "city": "Nashville", "state": "TN", "neighborhood": "Germantown",
         "zip": "37201", "categories": cats, "tierBand": "Locals",
         "compCategories": ["Restaurant meals"], "totalAudience": total,
         "audienceStack": {"instagram": total}, "platformFollowers": {"instagram": total},
         "localAudiencePct": pct, "paidRate": 150, "compOpen": True, "couponOpen": True,
         "profileComplete": True, "publicPage": True, "bio": f"{name} bio",
         "avgViews": 3000, "audienceMarkets": [{"market": "Nashville", "pct": pct}]}
    d = u(uid, role="creator", email=email, name=name, city="Nashville", market="Nashville", creator=c)
    if extra: d.update(extra)
    return d

data = {}
data["user:bizsalt"] = u("bizsalt", role="business", email="saltline@qa139.dev", name="Salt Line Owner",
    market="Nashville", tester=True,
    business={"businessName": "Salt Line Test Kitchen", "legalName": "SLTK LLC", "category": "Restaurant",
              "address": "100 Union St", "city": "Nashville", "state": "TN", "zip": "37201",
              "neighborhood": "Downtown", "phone": "6155550100", "website": ""},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["user:crmain"] = creator("crmain", "main@qa139.dev", "Maya Main", "mayamain", 86, 10000, ["Food & Drink"])
data["user:crtester"] = creator("crtester", "hello@xmedium.co", "Tess Tester", "tesstester", 80, 8000, ["Food & Drink"], extra={"tester": True})
for uid in ["bizsalt", "crmain", "crtester"]:
    data[f"email:{data['user:'+uid]['email']}"] = {"userId": uid}

tmp = tempfile.mkdtemp(prefix="signl-qa140-")
dbpath = os.path.join(tmp, "db.json")
with open(dbpath, "w") as f: json.dump(data, f)
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=dbpath, SIGNL_MAIL_STUB="1",
           APP_URL=BASE, ADMIN_EMAIL=ADMIN_EMAIL, ADMIN_PASSWORD=ADMIN_PW,
           SIGNL_TEST_ALLOW_BUSINESS="1")
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "FOUNDING_STRIPE_PRICES"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=APP, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

MEASURE = """(sel) => { const r = document.querySelector(sel); if (!r) return {missing: sel};
  const cs = getComputedStyle(r); const b = r.getBoundingClientRect();
  const groups = r.querySelectorAll('.df-group'); const last = groups[groups.length-1];
  const lb = last ? last.getBoundingClientRect() : null;
  const chain = []; let n = r.parentElement;
  while (n && n !== document.body) { const c = getComputedStyle(n);
    if (c.overflowY !== 'visible' || c.transform !== 'none' || c.position === 'sticky' || c.position === 'fixed')
      chain.push(n.tagName + '.' + (n.className||'') + ' ovY=' + c.overflowY + ' pos=' + c.position + ' tf=' + (c.transform!=='none'));
    n = n.parentElement; }
  return { position: cs.position, maxHeight: cs.maxHeight, overflowY: cs.overflowY,
    rectTop: Math.round(b.top), rectBottom: Math.round(b.bottom), rectH: Math.round(b.height),
    clientH: r.clientHeight, scrollH: r.scrollHeight, vh: window.innerHeight,
    scrollY: window.scrollY, docH: document.documentElement.scrollHeight,
    lastGroupBottom: lb ? Math.round(lb.bottom) : null, chain }; }"""

def login(ctx, email, pw=PW):
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw},
                         headers={"Content-Type": "application/json"})
    assert r.ok, f"login {email}: {r.status}"

CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
               ignore_https_errors=True)

try:
    for i in range(120):
        try:
            import urllib.request
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        actx = browser.new_context(**CTXOPTS)
        login(actx, ADMIN_EMAIL, ADMIN_PW)
        actx.request.post(BASE + "/api/admin/test-offers/load", data={}, headers={"Content-Type": "application/json"})

        for (vw, vh) in [(1440, 900), (1440, 760), (1875, 949)]:
            cctx = browser.new_context(viewport={"width": vw, "height": vh}, **CTXOPTS)
            login(cctx, "hello@xmedium.co")
            cp = cctx.new_page()
            cp.goto(BASE + "/", wait_until="networkidle")
            cp.evaluate("go('dashboard','Find Offers')")
            cp.wait_for_selector(".mirror-card", timeout=15000)
            cp.wait_for_timeout(400)
            m = cp.evaluate(MEASURE, "#fo-rail")
            print(f"\n=== Find offers #fo-rail @ {vw}x{vh} (rest) ===\n{json.dumps(m, indent=1)}")
            # wheel over the rail's visible middle
            box = cp.evaluate("""() => { const r = document.querySelector('#fo-rail').getBoundingClientRect();
              return {x: r.left + r.width/2, y: Math.min(r.top + r.height/2, window.innerHeight - 60)}; }""")
            cp.mouse.move(box["x"], box["y"]); cp.mouse.wheel(0, 600); cp.wait_for_timeout(500)
            m2 = cp.evaluate(MEASURE, "#fo-rail")
            st = cp.evaluate("document.querySelector('#fo-rail').scrollTop")
            print(f"after wheel 600 over rail: rail.scrollTop={st} window.scrollY={m2['scrollY']} lastGroupBottom={m2['lastGroupBottom']} vh={vh}")
            # scroll page to max, measure again
            cp.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            cp.wait_for_timeout(400)
            m3 = cp.evaluate(MEASURE, "#fo-rail")
            st3 = cp.evaluate("""() => { const r = document.querySelector('#fo-rail'); r.scrollTop = r.scrollHeight; return r.scrollTop; }""")
            m4 = cp.evaluate(MEASURE, "#fo-rail")
            print(f"page at max scrollY={m4['scrollY']}: rail rectTop={m4['rectTop']} bottom={m4['rectBottom']} lastGroupBottom={m4['lastGroupBottom']} (after rail.scrollTop=max -> {st3})")
            cctx.close()

            bctx = browser.new_context(viewport={"width": vw, "height": vh}, **CTXOPTS)
            login(bctx, "saltline@qa139.dev")
            bp = bctx.new_page()
            bp.goto(BASE + "/", wait_until="networkidle")
            bp.evaluate("go('dashboard','Discover')")
            bp.wait_for_selector(".shelf-tile", timeout=15000)
            bp.wait_for_timeout(400)
            mb = bp.evaluate(MEASURE, "#disc-rail")
            print(f"\n=== Find creators #disc-rail @ {vw}x{vh} (rest) ===\n{json.dumps(mb, indent=1)}")
            bctx.close()
        browser.close()
finally:
    server.kill()
print("\ndiagnostic done")
