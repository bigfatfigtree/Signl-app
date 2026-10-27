#!/usr/bin/env python3
"""Earn-row deep links — DOM click-through (Jeff, 2026-10-27).

Companion to verify-earnlinks.mjs (which pins the source contract
and the server due-state machine). This script drives the real app
in headless Chromium at 390px against a throwaway local DB and
proves the behavior in the browser:

  - actionable rows render as BUTTON.earn-link; checkmarked and
    outcome rows render as plain DIVs;
  - clicking a profile row lands on the Profile tab with the exact
    field focused (stack / best-work pick their first empty field);
  - clicking "Accept your first offer" lands on the Offers deck;
  - clicking "Invite creators" scrolls the roster panel into view;
  - the state-dependent rows (review / report numbers) render as
    links only while a visit is actually due, and clicking routes
    to that visit card (report row focuses its first field).

Run: PYTHONPATH=~/workspace/xmedium-qa/pylibs python3 scripts/verify-earnlinks-dom.py
Exits 0 when every check passes. Saves the 390px Momentum list
screenshot next to the goal files.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import http.cookiejar

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8990
BASE = f"http://127.0.0.1:{PORT}"
ADMIN_EMAIL = "admin@signl.test"
ADMIN_PW = "Pass" "word1!"
DAY = 24 * 3600 * 1000
SHOT_DIR = os.path.expanduser("~/workspace/goals/local-creator-platform-max-media-licensing-deal/files/signl-earn-links")
SHOT = os.path.join(SHOT_DIR, "momentum-list-390.png")

passed = 0
failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok {name}")
    else:
        failed += 1
        print(f"FAIL {name} :: {str(extra)[:300]}")


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def api(self, method, path, body=None):
        req = urllib.request.Request(
            BASE + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"},
        )
        try:
            with self.opener.open(req) as res:
                return res.status, json.loads(res.read().decode() or "null")
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {"raw": raw}

    def session_cookie(self):
        for c in self.jar:
            if c.name == "signl_session":
                return c.value
        return None


server = None
db_file = None


def start_server():
    global server
    env = {
        **os.environ,
        "SIGNL_LOCAL": "1",
        "SIGNL_LOCAL_DB": db_file,
        "SIGNL_TEST_ALLOW_BUSINESS": "1",
        "APP_URL": BASE,
        "ADMIN_EMAIL": ADMIN_EMAIL,
        "ADMIN_PASSWORD": ADMIN_PW,
    }
    log = open("/tmp/earnlinks-dom-server.log", "w")
    server = subprocess.Popen(
        ["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env, stdout=log, stderr=log
    )
    for _ in range(60):
        try:
            with urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2) as res:
                if res.status == 200:
                    return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("server did not come up")


def stop_server():
    global server
    if server:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()
        server = None
        time.sleep(0.4)


def register_creator(admin, email, handle, bio):
    c = Client()
    status, data = c.api("POST", "/api/auth/register", {
        "role": "creator", "name": "DOM Creator " + handle, "email": email, "password": "password123",
        "market": "Hampton Roads", "city": "Virginia Beach", "handle": handle, "tierBand": "Locals",
        "followerCount": 8400, "avgViews": 6200, "localAudiencePct": 62, "categories": ["Food & Drink"],
        "bio": bio, "agreedHonestPosts": True, "agreedFtcDisclosure": True,
        "agreedPostCompliance": True, "agreedTerms": True,
    })
    assert status == 201, f"creator register failed: {status} {data}"
    uid = data["user"]["id"]
    s, _ = admin.api("POST", "/api/admin/review", {"userId": uid, "decision": "approve"})
    assert s == 200, "creator approve failed"
    return c, uid


def main():
    global db_file
    import tempfile
    tmp = tempfile.mkdtemp(prefix="signl-earnlinks-dom-")
    db_file = os.path.join(tmp, "db.json")
    start_server()

    admin = Client()
    s, _ = admin.api("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PW})
    check("admin signs in", s == 200)

    # Creator A: bio / neighborhood / stack / best-work / first
    # offer / invites open; local % done; nothing due anywhere.
    ca, _uid_a = register_creator(admin, "doma@fixtures.dev", "doma757", "")
    cookie_a = ca.session_cookie()
    check("creator A session cookie issued", bool(cookie_a))

    # Creator B + business: a completed visit, then time travel so
    # the day-7 ask fires and both state-dependent rows come due.
    cb, uid_b = register_creator(admin, "domb@fixtures.dev", "domb757",
                                 "Verification account created by the DOM earn-links script.")
    biz = Client()
    s, breg = biz.api("POST", "/api/auth/register", {
        "role": "business", "name": "DOM Owner", "businessName": "DOM Table", "email": "dombiz@fixtures.dev",
        "password": "password123", "market": "Hampton Roads", "city": "Norfolk",
        "category": "Restaurant", "planId": "growth", "agreedTerms": True,
    })
    check("business registers", s == 201, str(breg)[:200])
    admin.api("POST", "/api/admin/review", {"userId": breg["user"]["id"], "decision": "approve"})
    s, _ = admin.api("POST", "/api/admin/businesses/activate", {"userId": breg["user"]["id"]})
    check("business activates", s == 200)
    s, offer = biz.api("POST", "/api/offers", {
        "title": "DOM dinner", "whatComped": "Dinner for two", "dollarCap": 75,
        "spots": 1, "visitWindow": "Any night", "creatorId": uid_b,
    })
    check("direct offer created", s == 201, str(offer)[:200])
    s, accept = cb.api("POST", f"/api/offers/{offer['offer']['id']}/accept", {"visitDate": "2026-10-22"})
    check("creator B accepts", s == 201, str(accept)[:200])
    booking = accept["booking"]
    s, _ = biz.api("POST", "/api/counter/redeem", {"code": booking["code"]})
    check("counter redeems", s == 200)
    s, _ = cb.api("POST", "/api/posts", {
        "bookingId": booking["id"], "url": "https://www.instagram.com/p/domlinks1/", "includesDisclosure": True,
    })
    check("creator B posts (booking completes)", s == 201)

    stop_server()
    with open(db_file) as f:
        db = json.load(f)
    for key, val in db.items():
        if key.startswith("post:") and val.get("bookingId") == booking["id"]:
            val["submittedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - 8 * 86400))
            val.pop("performanceRequestedAt", None)
    with open(db_file, "w") as f:
        json.dump(db, f)
    start_server()
    admin2 = Client()
    admin2.api("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PW})
    s, _ = admin2.api("POST", "/api/admin/compliance/sweep", {})
    check("compliance sweep ran (day-7 ask fires)", s == 200)
    cb2 = Client()
    cb2.api("POST", "/api/auth/login", {"email": "domb@fixtures.dev", "password": "password123"})
    cookie_b = cb2.session_cookie()
    check("creator B session cookie issued", bool(cookie_b))

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", headless=True)

        def new_page(cookie):
            ctx = browser.new_context(
                viewport={"width": 390, "height": 844},
                device_scale_factor=2, is_mobile=True, has_touch=True,
            )
            ctx.add_cookies([{"name": "signl_session", "value": cookie, "url": BASE}])
            pg = ctx.new_page()
            pg.goto(BASE, wait_until="networkidle")
            pg.wait_for_function("() => typeof state !== 'undefined' && !!state.user", timeout=15000)
            return ctx, pg

        def rows(pg):
            return pg.evaluate("""() => [...document.querySelectorAll('#tab-body .earn-row')]
              .filter(r => r.querySelector('.earn-state'))
              .map(r => ({
                label: r.querySelector('.earn-label').textContent.trim(),
                tag: r.tagName,
                link: r.classList.contains('earn-link'),
                done: r.classList.contains('done'),
              }))""")

        def row_by_label(pg, needle):
            for r in rows(pg):
                if needle.lower() in r["label"].lower():
                    return r
            return None

        def click_row(pg, needle):
            loc = pg.locator("#tab-body .earn-row", has_text=needle).first
            loc.scroll_into_view_if_needed()
            loc.click()

        def active_id(pg):
            return pg.evaluate("() => document.activeElement && document.activeElement.id")

        # ---------- creator A: row kinds ----------
        ctx_a, pa = new_page(cookie_a)
        pa.evaluate("go('dashboard','Momentum')")
        pa.wait_for_selector("#tab-body .earn-row", timeout=10000)
        expect = [
            ("Add your profile photo", True), ("Write your bio", True),
            ("Set your neighborhood", True), ("Report your local audience", "done"),
            ("Complete your audience stack", True), ("Add best work links", True),
            ("Accept your first offer", True), ("Deliver a post on time", False),
            ("Hit a 5-post", False), ("Review a business", False),
            ("Have a paid-visit post", False), ("Report a post's views", False),
            ("Invite creators", True),
        ]
        for needle, want in expect:
            r = row_by_label(pa, needle)
            if want == "done":
                check(f"A: '{needle}' is checkmarked and plain", bool(r) and r["done"] and not r["link"] and r["tag"] == "DIV", str(r))
            elif want:
                check(f"A: '{needle}' is a linked button", bool(r) and r["link"] and r["tag"] == "BUTTON", str(r))
            else:
                check(f"A: '{needle}' stays plain", bool(r) and not r["link"] and r["tag"] == "DIV", str(r))

        os.makedirs(SHOT_DIR, exist_ok=True)
        pa.screenshot(path=SHOT, full_page=True)
        check("390px Momentum list screenshot saved", os.path.exists(SHOT))

        # ---------- creator A: click-through ----------
        click_row(pa, "Write your bio")
        pa.wait_for_function("() => document.activeElement && document.activeElement.id === 'p-bio'", timeout=5000)
        check("A: bio row click lands on Profile with the bio field focused", active_id(pa) == "p-bio")

        pa.evaluate("go('dashboard','Momentum')")
        pa.wait_for_selector("#tab-body .earn-row", timeout=10000)
        click_row(pa, "Set your neighborhood")
        pa.wait_for_function("() => document.activeElement && document.activeElement.id === 'p-neighborhood'", timeout=5000)
        check("A: neighborhood row click focuses the neighborhood field", active_id(pa) == "p-neighborhood")

        pa.evaluate("go('dashboard','Momentum')")
        pa.wait_for_selector("#tab-body .earn-row", timeout=10000)
        click_row(pa, "Complete your audience stack")
        pa.wait_for_function("() => document.activeElement && document.activeElement.id === 'p-stack-tiktok'", timeout=5000)
        check("A: stack row click focuses the first empty platform field (TikTok; Instagram is filled)",
              active_id(pa) == "p-stack-tiktok", active_id(pa))

        pa.evaluate("go('dashboard','Momentum')")
        pa.wait_for_selector("#tab-body .earn-row", timeout=10000)
        click_row(pa, "Add best work links")
        pa.wait_for_function("() => document.activeElement && document.activeElement.id === 'p-work-0'", timeout=5000)
        check("A: best-work row click focuses the first empty link field", active_id(pa) == "p-work-0")

        pa.evaluate("go('dashboard','Momentum')")
        pa.wait_for_selector("#tab-body .earn-row", timeout=10000)
        click_row(pa, "Add your profile photo")
        pa.wait_for_function("() => !!document.getElementById('p-gallery')", timeout=5000)
        pa.wait_for_function("""() => { const el = document.getElementById('p-gallery');
          if (!el) return false; const r = el.getBoundingClientRect();
          return r.top < innerHeight && r.bottom > 0; }""", timeout=6000)
        check("A: photo row click lands on Profile scrolled to the photo gallery", True)

        pa.evaluate("go('dashboard','Momentum')")
        pa.wait_for_selector("#tab-body .earn-row", timeout=10000)
        click_row(pa, "Accept your first offer")
        pa.wait_for_function("() => typeof state !== 'undefined' && state.tab === 'Offers' && !!document.getElementById('cr-offers-segs')", timeout=8000)
        check("A: first-offer row click lands on the Offers deck", True)

        pa.evaluate("go('dashboard','Momentum')")
        pa.wait_for_selector("#grow-roster", timeout=10000)
        click_row(pa, "Invite creators")
        pa.wait_for_function("""() => { const el = document.getElementById('grow-roster');
          if (!el) return false; const r = el.getBoundingClientRect();
          return r.top < innerHeight && r.top > -40; }""", timeout=6000)
        check("A: invite row click scrolls the roster panel into view", True)
        ctx_a.close()

        # ---------- creator B: state-dependent rows ----------
        ctx_b, pb = new_page(cookie_b)
        pb.evaluate("go('dashboard','Momentum')")
        pb.wait_for_selector("#tab-body .earn-row", timeout=10000)
        r = row_by_label(pb, "Review a business")
        check("B: review row is a link while a completed visit is unreviewed",
              bool(r) and r["link"] and r["tag"] == "BUTTON", str(r))
        r = row_by_label(pb, "Report a post's views")
        check("B: report row is a link while the ask is unanswered",
              bool(r) and r["link"] and r["tag"] == "BUTTON", str(r))

        click_row(pb, "Review a business")
        pb.wait_for_selector(f"#visit-{booking['id']}", timeout=10000)
        in_view = pb.evaluate(f"""() => {{ const el = document.getElementById('visit-{booking['id']}');
          const r = el.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }}""")
        check("B: review row click lands on My Visits at that visit's card", in_view)
        has_form = pb.evaluate(f"() => !!document.querySelector('#visit-{booking['id']} form')")
        check("B: the landed card carries the review form", has_form)

        pb.evaluate("go('dashboard','Momentum')")
        pb.wait_for_selector("#tab-body .earn-row", timeout=10000)
        click_row(pb, "Report a post's views")
        pb.wait_for_function(f"() => document.activeElement && document.activeElement.id === 'perf-views-{booking['id']}'", timeout=8000)
        check("B: report row click lands on the visit with the views field focused",
              active_id(pb) == f"perf-views-{booking['id']}", active_id(pb))
        ctx_b.close()
        browser.close()

    print(f"\nverify-earnlinks-dom: {passed} passed, {failed} failed")
    return 1 if failed else 0


try:
    code = main()
except Exception as err:  # noqa: BLE001
    import traceback
    traceback.print_exc()
    print(f"verify-earnlinks-dom crashed: {err}")
    code = 1
finally:
    stop_server()
sys.exit(code)
