#!/usr/bin/env python3
"""Partner dashboard DOM QA (Jeff, 2026-10-28).

Companion to verify-partner.mjs (the API contract). Drives the
real app in headless Chromium at 390 and 1280 against a throwaway
local DB: seeds the demo partner through the Admin endpoint,
gives it a known password locally, signs in through the real
sign-in form, and walks every partner view plus the Admin
Partners tab, saving inspected screenshots to the goal files.

Run: PYTHONPATH=~/workspace/xmedium-qa/pylibs python3 scripts/verify-partner-dom.py
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import http.cookiejar

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8973
BASE = f"http://127.0.0.1:{PORT}"
ADMIN_EMAIL = "jeff@joinsignl.com"
ADMIN_PW = "partner-admin-" "pass-123"
DEMO_PW = "demo-pass-" "1234"
SHOT_DIR = os.path.expanduser("~/workspace/goals/local-creator-platform-max-media-licensing-deal/files")
DB = f"/tmp/signl-verify-partner-dom-{int(time.time())}.json"

passed = 0
failed = 0


def has(body, text):
    return text.lower() in body.lower()


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
            BASE + path, method=method,
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


server = None


def start_server():
    global server
    env = {**os.environ, "SIGNL_LOCAL": "1", "SIGNL_LOCAL_DB": DB,
           "SIGNL_TEST_ALLOW_BUSINESS": "1", "APP_URL": BASE,
           "ADMIN_EMAIL": ADMIN_EMAIL, "ADMIN_PASSWORD": ADMIN_PW}
    log = open("/tmp/partner-dom-server.log", "w")
    server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env, stdout=log, stderr=log)
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


def node(script):
    out = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr[:400])
    return out.stdout.strip()


def shot(page, name):
    path = os.path.join(SHOT_DIR, name)
    page.screenshot(path=path)
    return path


def sign_in(page, email, password):
    page.goto(BASE + "/", wait_until="domcontentloaded")
    page.wait_for_selector("a.nav-signin", timeout=15000)
    page.click("a.nav-signin")
    page.wait_for_selector("#si-email", timeout=8000)
    page.fill("#si-email", email)
    page.fill("#si-password", password)
    page.click("button[type=submit]")
    page.wait_for_timeout(1800)


def main():
    # Seed: one real (empty) partner with a known password.
    seed_script = f"""
const auth = require("./netlify/functions/lib/auth.js");
const fs = require("fs");
function partnerUser(id, email, password, partner) {{
  const {{ salt, hash }} = auth.hashPassword(password);
  return {{ id, role: "partner", email, name: partner.contactName, passwordSalt: salt, passwordHash: hash,
    status: "approved", tester: false, market: partner.markets[0], createdAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-28T12:00:00.000Z", reviewedAt: "2026-10-28T12:00:00.000Z", termsVersion: "2026-10-19",
    termsAcceptedAt: "2026-10-28T12:00:00.000Z", creator: null, business: null, partner }};
}}
const pA = partnerUser("partner-a-id", "partnera@fixtures.dev", "partner-a-" + "pass-123",
  {{ name: "Acme Media", type: "media", contactName: "Ann Acme", code: "acme-media", markets: ["Virginia Beach"],
     sharePct: 50, status: "active", agreementStatus: "unsigned", demo: false, createdAt: "2026-10-28T12:00:00.000Z" }});
const db = {{ ["user:" + pA.id]: pA, ["email:" + pA.email]: {{ userId: pA.id }} }};
fs.writeFileSync({json.dumps(DB)}, JSON.stringify(db));
console.log("seeded");
"""
    node(seed_script)
    start_server()
    admin = Client()
    status, _ = admin.api("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PW})
    check("admin logs in", status == 200)
    status, demo = admin.api("POST", "/api/admin/partners/demo")
    check("demo partner seeded via Admin", status == 200 and demo.get("created") is True, str(demo)[:200])
    stop_server()
    # Give the demo partner a known password in the LOCAL db only.
    node(f"""
const auth = require("./netlify/functions/lib/auth.js");
const fs = require("fs");
const db = JSON.parse(fs.readFileSync({json.dumps(DB)}, "utf8"));
for (const k of Object.keys(db)) {{
  if (k.startsWith("user:") && db[k].role === "partner" && db[k].partner && db[k].partner.demo) {{
    const {{ salt, hash }} = auth.hashPassword({json.dumps(DEMO_PW)});
    db[k].passwordSalt = salt; db[k].passwordHash = hash;
  }}
}}
fs.writeFileSync({json.dumps(DB)}, JSON.stringify(db));
console.log("demo password set locally");
""")
    start_server()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chromium")
        # ---- demo partner, phone width ----
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        sign_in(page, "jeff+partnerdemo@joinsignl.com", DEMO_PW)
        page.wait_for_timeout(1200)
        body = page.inner_text("body")
        check("demo partner lands on their dashboard", has(body, "Demo Media Group"), body[:200])
        check("home shows sample chip", has(body, "Sample data"))
        check("home shows attributed funnel numbers", has(body, "Creators claimed") and has(body, "Share accrued"), body[:300])
        shot(page, "signl-partner-qa-demo-home-390-2026-10-28.png")
        for tab, expect in [("Markets", "Creators claimed"), ("Earnings", "Your earnings"), ("More", "Links & assets")]:
            page.click(f".tab-item:has-text('{tab}')")
            page.wait_for_timeout(900)
            body = page.inner_text("body")
            check(f"tab {tab} renders", has(body, expect), body[:200])
            shot(page, f"signl-partner-qa-demo-{tab.lower()}-390-2026-10-28.png")
        page.click(".more-row:has-text('Creators')")
        page.wait_for_timeout(900)
        body = page.inner_text("body")
        check("creators view lists sample bench with local %", has(body, "samplebeachfoodie") and has(body, "Local 78%"), body[:300])
        check("creators view has no email addresses", "@sample.signl.demo" not in body)
        shot(page, "signl-partner-qa-demo-creators-390-2026-10-28.png")
        page.click(".tab-item:has-text('More')")
        page.wait_for_timeout(600)
        page.click(".more-row:has-text('Businesses')")
        page.wait_for_timeout(900)
        body = page.inner_text("body")
        check("businesses view lists sample businesses", has(body, "Sample Cafe") and has(body, "Sample Tacos"), body[:300])
        shot(page, "signl-partner-qa-demo-businesses-390-2026-10-28.png")
        page.click(".tab-item:has-text('More')")
        page.wait_for_timeout(600)
        page.click(".more-row:has-text('Performance')")
        page.wait_for_timeout(900)
        body = page.inner_text("body")
        check("performance view shows posts and value", has(body, "Posts live") and has(body, "Register value tracked") and has(body, "$212"), body[:300])
        shot(page, "signl-partner-qa-demo-performance-390-2026-10-28.png")
        page.click(".tab-item:has-text('More')")
        page.wait_for_timeout(600)
        page.click(".more-row:has-text('Links & assets')")
        page.wait_for_timeout(900)
        body = page.inner_text("body")
        check("links view shows tracked links with partner code", has(body, "src=partner-demo") and has(body, "How your share works"), body[:300])
        shot(page, "signl-partner-qa-demo-links-390-2026-10-28.png")
        page.click(".tab-item:has-text('More')")
        page.wait_for_timeout(600)
        page.click(".more-row:has-text('Account')")
        page.wait_for_timeout(900)
        body = page.inner_text("body")
        check("account view shows agreement state", has(body, "Not signed yet") and has(body, "Your account"), body[:300])
        shot(page, "signl-partner-qa-demo-account-390-2026-10-28.png")
        ctx.close()

        # ---- demo partner, desktop width ----
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        sign_in(page, "jeff+partnerdemo@joinsignl.com", DEMO_PW)
        page.wait_for_timeout(1200)
        body = page.inner_text("body")
        check("desktop rail shows partner destinations", has(body, "Markets") and has(body, "Earnings"), body[:200])
        shot(page, "signl-partner-qa-demo-home-1280-2026-10-28.png")
        ctx.close()

        # ---- real partner with no activity: fills-in voice ----
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        sign_in(page, "partnera@fixtures.dev", "partner-a-" "pass-123")
        page.wait_for_timeout(1200)
        body = page.inner_text("body")
        check("empty partner sees the fills-in voice", has(body, "Your funnel fills in"), body[:300])
        check("empty partner sees no zero grid", not has(body, "Share accrued"), body[:200])
        shot(page, "signl-partner-qa-empty-home-390-2026-10-28.png")
        ctx.close()

        # ---- admin partners tab ----
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        sign_in(page, ADMIN_EMAIL, ADMIN_PW)
        page.wait_for_timeout(1200)
        page.click(".tabs button:has-text('Partners')")
        page.wait_for_timeout(1200)
        body = page.inner_text("body")
        check("admin partners tab lists partners with codes", has(body, "acme-media") and has(body, "Demo Media Group"), body[:300])
        check("admin partners tab has the create form", has(body, "New partner") and has(body, "Create partner"), body[:200])
        shot(page, "signl-partner-qa-admin-partners-1280-2026-10-28.png")
        ctx.close()
        browser.close()

    stop_server()
    try:
        os.unlink(DB)
    except Exception:
        pass
    print(f"\nverify-partner-dom: {passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
