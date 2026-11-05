#!/usr/bin/env python3
"""Rendered gate: Admin Stats headline band must show its numbers.

Build -131 hotfix (Jeff, live on production 2026-11-05): the
Stats band rendered as four EMPTY dark boxes on his phone, and
the -130 QA screenshot showed the same empties unspotted —
the QA captured pixels without ever reading them. This gate
therefore ASSERTS CONTENT: it boots a fixture server, signs in
as Admin at phone width (390x844, DPR 3, the house QA chain),
opens Stats, and fails unless every headline stat cell renders
its label AND a non-empty value, with the signed-up count exact
against the fixtures. It also screenshots the band for the
human look the AGENTS.md rule requires.

Run: python3 scripts/qa-stats-band.py [out.png]
Needs the Playwright pylibs at ~/workspace/xmedium-qa/pylibs.
"""
import sys, json, os, signal, subprocess, time
sys.path.insert(0, "/home/hatch/workspace/xmedium-qa/pylibs")
import urllib.request
from playwright.sync_api import sync_playwright

PORT = 8951
BASE = f"http://127.0.0.1:{PORT}"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = "/tmp/qa-stats-band-db.json"
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/workspace/research_notes/signl-build131-qa/05-admin-stats-390-fixed.png")
ADMIN_EMAIL, ADMIN_PW = "jeff@joinsignl.com", "qa-stats-admin-123"
AGREE = {"agreedHonestPosts": True, "agreedFtcDisclosure": True,
         "agreedPostCompliance": True, "agreedTerms": True}
fails = []

def call(method, path, body=None, cookie=""):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Cookie": cookie} if cookie else {})},
        method=method)
    with urllib.request.urlopen(req) as resp:
        sc = resp.headers.get("Set-Cookie", "")
        text = resp.read().decode()
    pair = sc.split(";")[0] if sc else ""
    return (json.loads(text) if text else {}), pair

def check(name, cond, extra=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + ((" :: " + str(extra)) if not cond and extra else ""))
    if not cond: fails.append(name)

if os.path.exists(DB): os.remove(DB)
env = {**os.environ, "SIGNL_LOCAL": "1", "SIGNL_LOCAL_DB": DB,
       "ADMIN_EMAIL": ADMIN_EMAIL, "ADMIN_PASSWORD": ADMIN_PW,
       "APP_URL": BASE, "SIGNL_TEST_ALLOW_BUSINESS": "1"}
for k in ["SIG_AI_API_KEY", "SIG_AI_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)],
                          cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    up = False
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); up = True; break
        except Exception: time.sleep(0.25)
    check("fixture server boots", up)

    # Three creators with known audiences: totals 4,571 / 2,000 /
    # 1,200 at 64% / 50% / 80% local -> signed up 3, followers
    # 7,771, avg % local 65%. Register semantics: followerCount
    # is the PRIMARY platform's count and merges into the stack,
    # so each fixture passes its primary count, not the total.
    ids = []
    for i, (stack, primary, pct) in enumerate([({"instagram": 3000, "tiktok": 1321, "youtube": 250}, "instagram", 64),
                                               ({"instagram": 2000}, "instagram", 50),
                                               ({"tiktok": 1200}, "tiktok", 80)]):
        d, _ = call("POST", "/api/auth/register", {
            "role": "creator", "name": f"Stats Creator {i}", "email": f"stats{i}@fixtures.dev",
            "password": "creator-pass-123", "market": "Richmond", "city": "Richmond",
            "handle": f"statscr{i}", "tierBand": "Locals", "primaryPlatform": primary,
            "followerCount": stack[primary], "audienceStack": stack,
            "localAudiencePct": pct, "categories": ["Food & Drink"], **AGREE})
        ids.append(d["user"]["id"])
    _, admin_cookie = call("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PW})
    for uid in ids:
        call("POST", "/api/admin/review", {"userId": uid, "decision": "approve"}, admin_cookie)

    def login_cookie():
        _, pair = call("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PW})
        k, v = pair.split("=", 1)
        return {"name": k.strip(), "value": v.strip(), "url": BASE}

    UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
          "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium")
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3,
                            is_mobile=True, has_touch=True, user_agent=UA, ignore_https_errors=True)
        ctx.add_cookies([login_cookie()])
        pg = ctx.new_page()
        pg.goto(BASE + "/", wait_until="networkidle")
        pg.wait_for_timeout(1200)
        # Open the Stats tab (bottom phone bar / rail item).
        pg.evaluate("""() => { const els = [...document.querySelectorAll('button, a, .tab-item, .rail-row')];
          const hit = els.filter(e => (e.textContent || '').trim() === 'Stats').pop();
          if (hit) hit.click(); }""")
        pg.wait_for_selector("#ast-charts .stat-band .stat-cell", timeout=20000)
        pg.wait_for_timeout(600)
        cells = pg.evaluate("""() => { const band = document.querySelectorAll('#ast-charts .stat-band')[0];
          return [...band.querySelectorAll('.stat-cell')]
          .map(c => ({ num: (c.querySelector('.stat-num') || {}).textContent || '',
                       lbl: (c.querySelector('.stat-lbl') || {}).textContent || '',
                       text: c.innerText || '' })); }""")
        check("headline band renders exactly 4 stat cells", len(cells) == 4, len(cells))
        # fmtNum abbreviates thousands: 7,771 -> "7.8k", local
        # followers 2,925 + 1,000 + 960 = 4,885 -> "4.9k". The
        # Followers figure is the stacked-truth assertion: read
        # through the payload's precomputed totalAudience it is
        # 7,771; the -130 reader's ".stack" miss showed 6.2k.
        want = [("Creators signed up", "3"), ("Followers", "7.8k"),
                ("Local followers", "4.9k"), ("Avg % local", "65%")]
        for i, (lbl, val) in enumerate(want):
            c = cells[i] if i < len(cells) else {}
            check(f"cell {i+1} label is '{lbl}'", c.get("lbl", "").strip() == lbl, c)
            check(f"cell {i+1} value is non-empty", bool(c.get("num", "").strip()), c)
            if val: check(f"cell {i+1} value is {val}", c.get("num", "").strip() == val, c)
        rev = pg.evaluate("""() => [...document.querySelectorAll('#ast-charts .stat-band .stat-cell')]
          .map(c => c.innerText || '')""")
        check("revenue band cells render labels + values too",
              any("Collected so far" in t and "$0" in t for t in rev) and any("Founding pipeline" in t for t in rev), rev)
        el = pg.query_selector("#ast-charts .stat-band")
        el.scroll_into_view_if_needed()
        pg.wait_for_timeout(400)
        pg.screenshot(path=OUT)
        print("screenshot:", OUT)
        b.close()
finally:
    server.send_signal(signal.SIGTERM)

print("qa-stats-band:", "ALL PASS" if not fails else f"{len(fails)} FAILURE(S)")
sys.exit(0 if not fails else 1)
