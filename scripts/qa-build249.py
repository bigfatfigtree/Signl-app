#!/usr/bin/env python3
# qa-build249.py — Build -249 rendered QA.
# Boots the real app (dev-server + local store + mail stub) and
# walks the creator claim flow as a stranger at 390px and on
# desktop: Screen 1 (welcome), Step 2 facts (no email field,
# categories start unchecked, new follower copy), Step 4
# account (general post agreement, exactly one email field, no
# push prompt inside the form), and the rebuilt confirmation
# screen after a REAL submit (You've applied, 3 steps, stat
# card, push card present, no number/position language).
# Every screenshot is asserted for key content, and every <img>
# on each screen must actually load (workspace QA rule).
# Run: python3 scripts/qa-build249.py
import json
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
os.environ.setdefault("no_proxy", "127.0.0.1,localhost")
os.environ.setdefault("NO_PROXY", "127.0.0.1,localhost")

from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROOF = os.path.join(ROOT, "docs", "build-249-proof")
os.makedirs(PROOF, exist_ok=True)
PORT = 8971
BASE = f"http://127.0.0.1:{PORT}"
DB = "/tmp/qa249-db.json"
if os.path.exists(DB):
    os.remove(DB)

env = {
    **os.environ,
    "SIGNL_LOCAL": "1",
    "SIGNL_LOCAL_DB": DB,
    "SIGNL_MAIL_STUB": "1",
    "ADMIN_EMAIL": "jeff@joinsignl.com",
    "ADMIN_PASSWORD": "verify-admin-pass-123",
    "APP_URL": BASE,
    "SIGNL_TEST_ALLOW_BUSINESS": "1",
}

results = []


def check(name, cond, extra=""):
    results.append({"name": name, "ok": bool(cond), "extra": str(extra)[:200]})
    print(("  PASS  " if cond else "  FAIL  ") + name + ("" if cond else f" :: {extra}"))


def imgs_ok(page):
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('img'))
            .filter(i => !(i.complete && i.naturalWidth > 0))
            .map(i => i.getAttribute('src') || '(no src)')"""
    )


server = subprocess.Popen(
    ["node", "scripts/dev-server.mjs", str(PORT)],
    cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    up = False
    for _ in range(60):
        try:
            with urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2) as r:
                if r.status == 200:
                    up = True
                    break
        except Exception:
            time.sleep(0.5)
    if not up:
        print("server did not come up")
        sys.exit(1)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chromium")
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2, is_mobile=True, has_touch=True,
        )
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_function("() => window.__SIGNL_BUILD__ === '2026.11.21-249' && typeof render === 'function'")
        check("app boots on the -249 stamp", True)

        # --- Screen 1 (welcome), as a stranger lands on it ---
        page.evaluate("""() => {
          state.view = 'join-creator'; state.joinMode = 'quick'; state.claimStep = 1;
          render();
        }""")
        page.wait_for_selector("#c85-handle")
        page.locator('.chiprow [data-val="tiktok"]').first.click()
        page.fill("#c85-handle", "qa249creator")
        page.screenshot(path=os.path.join(PROOF, "01-welcome-390.png"))
        check("screen 1 renders the claim welcome (handle field present)", page.locator("#c85-handle").count() == 1)
        check("screen 1: all images loaded", imgs_ok(page) == [], imgs_ok(page))

        # --- Step 2: facts ---
        page.locator('button[onclick*="claimWelcomeGo"]').click()
        page.wait_for_selector("#c85-cats", timeout=30000)
        body_text = page.locator("body").inner_text()
        check("step 2: NO stall-capture email field", page.locator("#jc-email-stall").count() == 0 and "reach you if you get cut off" not in body_text)
        unchecked = page.evaluate("""() => {
          const boxes = Array.from(document.querySelectorAll('#c85-cats input[type=checkbox]'));
          return { total: boxes.length, checked: boxes.filter(b => b.checked).length };
        }""")
        check("step 2: categories start with NONE checked", unchecked["total"] >= 12 and unchecked["checked"] == 0, unchecked)
        check("step 2: new category copy (tick what fits), old pre-tick copy gone",
              "Tick everything that fits" in body_text and "ticked everything for you" not in body_text)
        page.fill("#c85-stack-tiktok", "2400")
        page.fill("#c85-stack-instagram", "800")
        page.fill("#c85-localpct", "48")
        page.select_option("#c85-market", "Virginia Beach")
        page.wait_for_function("() => document.querySelectorAll('#c85-city option').length > 1")
        page.evaluate("() => { const s = document.getElementById('c85-city'); s.selectedIndex = 1; s.dispatchEvent(new Event('change')); }")
        page.locator("#c85-cats label", has_text="Food & Drink").first.click()
        counted = page.locator("#c85-counted").inner_text()
        check("step 2: counted line is alive (3,200 counted)", "3,200" in counted, counted)
        check("step 2: no 'can't look up' confession anywhere", "can't look up" not in page.locator("body").inner_text())
        page.screenshot(path=os.path.join(PROOF, "02-step2-facts-390.png"), full_page=True)
        check("step 2: all images loaded", imgs_ok(page) == [], imgs_ok(page))
        page.set_viewport_size({"width": 1280, "height": 900})
        page.screenshot(path=os.path.join(PROOF, "03-step2-facts-desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})

        # --- Step 3 (markets) pass-through, then Step 4 ---
        page.locator('button[onclick*="claimFactsGo"]').click()
        page.wait_for_selector('button[onclick*="claimMarketsGo"]', timeout=15000)
        page.locator('button[onclick*="claimMarketsGo"]').click()
        page.wait_for_selector("#c85-agree-post", timeout=15000)
        body_text = page.locator("body").inner_text()
        check("step 4: general post agreement text (per-offer terms), old specifics gone",
              "follow the terms of each offer I accept" in body_text and "keep the post live for at least 30 days" not in body_text)
        email_inputs = page.locator('.c85-card input[type="email"]').count()
        check("step 4: exactly ONE email field in the whole flow form", email_inputs == 1, f"email inputs={email_inputs}")
        check("step 4: NO push prompt inside the form", page.locator("[data-push226]").count() == 0)
        page.wait_for_timeout(800)  # let the screen's fade-in settle before the shot
        page.screenshot(path=os.path.join(PROOF, "04-step4-account-390.png"), full_page=True)
        check("step 4: all images loaded", imgs_ok(page) == [], imgs_ok(page))

        # --- Submit for real, land on the rebuilt done screen ---
        page.fill("#c85-email", "qa249@fixtures.dev")
        page.fill("#c85-password", "qa249-pass-12345")
        page.locator("label.ckrow", has_text="post agreement").first.click()
        page.locator("label.ckrow", has_text="Terms of Service").first.click()
        t0 = time.time()
        page.locator('button[onclick*="doQuickClaim"], form[onsubmit*="doQuickClaim"] button[type="submit"], button:has-text("Finish")').first.click()
        page.wait_for_selector("#claim-next-steps", timeout=30000)
        submit_secs = time.time() - t0
        print(f"  .. in-browser submit-to-done: {submit_secs:.1f}s (local dev server, unloaded)")
        body_text = page.locator("body").inner_text()
        check("done: headline reads You've applied", "You've applied" in body_text)
        check("done: the 3 steps render with the dashboard promise",
              "We review by hand" in body_text and "Your full dashboard opens" in body_text)
        nb_big = page.locator("#nb-big").inner_text() if page.locator("#nb-big").count() else ""
        check("done: stat card big number present and non-empty", nb_big.replace(",", "").strip().isdigit() and int(nb_big.replace(",", "")) > 0, nb_big)
        check("done: stat card line names the market", "of your followers live in Virginia Beach" in body_text)
        check("done: founding standing with NO numbers (no first-100, no out-of-10, no order)",
              "founding creator in Virginia Beach" in body_text and "first 100" not in body_text
              and "out of 10" not in body_text and "founding order" not in body_text)
        check("done: push reminder card now lives here", page.locator("[data-push226]").count() == 1)
        check("done: Maggie stack card present, compact", "Want a bigger number?" in body_text)
        page.screenshot(path=os.path.join(PROOF, "05-done-390.png"), full_page=True)
        page.screenshot(path=os.path.join(PROOF, "06-done-390-viewport.png"))
        page.locator("#claim-next-steps").scroll_into_view_if_needed()
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(PROOF, "06b-done-390-steps.png"))
        check("done: all images loaded", imgs_ok(page) == [], imgs_ok(page))
        page.set_viewport_size({"width": 1280, "height": 900})
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(PROOF, "07-done-desktop.png"), full_page=True)
        page.screenshot(path=os.path.join(PROOF, "08-done-desktop-viewport.png"))
        browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()

failed = [r for r in results if not r["ok"]]
print(f"\nqa-build249: {len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
