#!/usr/bin/env python3
"""Account deletion rendered QA (Build -132 standalone ship):
Settings -> Account -> "Delete my account" on desktop + 390px,
for a creator and a business, plus the Admin card action.
CONTENT ASSERTIONS throughout (the -130 lesson): the reveal is
nested (panel hidden until the button is clicked), the confirm
copy states what is deleted and the in-flight rules, and the
confirm button stays disabled until DELETE is typed. The
erasure itself is proven by scripts/verify-deletion.mjs; this
pass never submits a deletion.
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-deletion-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9077
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-del-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const now = new Date().toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "delcr", role: "creator", email: "delcr@delqa.dev", name: "Dana Delete", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: now, updatedAt: now,
  creator: { handle: "danadelete", primaryPlatform: "instagram", followerCount: 3200, totalAudience: 3200, audienceStack: { instagram: 3200 }, categories: ["Food & Drink"], localAudiencePct: 64, tierBand: "Locals", profileComplete: true, publicPage: true, hasPhoto: false, bio: "" } });
putUser({ id: "delbiz", role: "business", email: "delbiz@delqa.dev", name: "Bob Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: now, updatedAt: now,
  business: { businessName: "Dana's Diner", category: "Restaurant", plan: "self-service", planId: "self-service", about: "Counter diner." } });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-del-132"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE, ADMIN_EMAIL="admin@delqa.dev", ADMIN_PASSWORD=ADMIN_PW)
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
R = {}
try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def login(ctx, email, password="qa-pass-1234"):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": password})
            return r.status

        def shot(page, name):
            page.screenshot(path=os.path.join(OUT, name + ".png"))

        def overflow(page):
            return page.evaluate("Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth")

        def click_visible_text(page, text, timeout=30000):
            page.wait_for_function("""(t) => [...document.querySelectorAll('a,button,div,span')].some((e) => e.children.length === 0 && e.textContent.trim() === t && e.getClientRects().length > 0)""", arg=text, timeout=timeout)
            ok = page.evaluate("""(t) => {
              const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
              const els = [...document.querySelectorAll('a,button,div,span')];
              const el = els.find((e) => e.children.length === 0 && e.textContent.trim() === t && vis(e))
                || els.find((e) => e.textContent.trim() === t && vis(e));
              if (!el) return false;
              (el.closest('a,button,[onclick]') || el).click();
              return true;
            }""", text)
            assert ok, f"no visible '{text}' to click"

        def open_settings(page):
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_selector("text=Settings", state="attached", timeout=30000)
            try:
                click_visible_text(page, "Settings", timeout=6000)
            except Exception:
                # Phone layout: Settings sits inside the
                # "Everything" panel off the top bar.
                page.click("button.tb2-ev125", timeout=10000)
                click_visible_text(page, "Settings")
            page.wait_for_selector("text=Your account", timeout=30000)

        def exercise_delete_panel(page, role_word, inflight_word, tag):
            body = page.inner_text("body")
            assert "Delete my account" in body, f"{tag}: nested delete button missing"
            panel = page.locator("#delacct-panel")
            assert not panel.is_visible(), f"{tag}: confirm panel must start hidden (nested, not first-layer)"
            page.click("button:has-text('Delete my account') >> nth=0")
            page.wait_for_selector("#delacct-panel", state="visible", timeout=10000)
            txt = panel.inner_text()
            R[tag + "_panel"] = txt.replace("\n", " | ")[:400]
            for want in ["This cannot be undone", "Type DELETE to confirm", "sign-in", "referral", inflight_word]:
                assert want.lower() in txt.lower(), f"{tag}: panel missing '{want}': {txt[:300]}"
            go_btn = page.locator("#delacct-go")
            assert go_btn.is_disabled(), f"{tag}: confirm must stay disabled until DELETE is typed"
            page.fill("#delacct-confirm", "DELETE")
            assert go_btn.is_enabled(), f"{tag}: confirm must enable once DELETE is typed"
            return txt

        # ---------- creator, desktop ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        assert login(ctx, "delcr@delqa.dev") == 200
        page = ctx.new_page()
        open_settings(page)
        shot(page, "01-creator-settings-desktop")
        exercise_delete_panel(page, "creator", "Applications you have not heard back on are withdrawn", "creator_desktop")
        page.locator("#delacct-panel").scroll_into_view_if_needed()
        shot(page, "02-creator-delete-confirm-desktop")
        R["creator_desktop_overflow"] = overflow(page)
        assert R["creator_desktop_overflow"] <= 0
        ctx.close()

        # ---------- creator, 390px ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        assert login(ctx, "delcr@delqa.dev") == 200
        page = ctx.new_page()
        open_settings(page)
        exercise_delete_panel(page, "creator", "Applications you have not heard back on are withdrawn", "creator_390")
        page.locator("#delacct-panel").scroll_into_view_if_needed()
        shot(page, "03-creator-delete-confirm-390")
        R["creator_390_overflow"] = overflow(page)
        assert R["creator_390_overflow"] <= 0, f"390 overflow {R['creator_390_overflow']}"
        ctx.close()

        # ---------- business, desktop ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        assert login(ctx, "delbiz@delqa.dev") == 200
        page = ctx.new_page()
        open_settings(page)
        exercise_delete_panel(page, "business", "Offers you have posted are closed", "business_desktop")
        page.locator("#delacct-panel").scroll_into_view_if_needed()
        shot(page, "04-business-delete-confirm-desktop")
        ctx.close()

        # ---------- admin card ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        assert login(ctx, "admin@delqa.dev", ADMIN_PW) == 200
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded")
        page.wait_for_selector("text=Review", state="attached", timeout=30000)
        page.wait_for_function("() => typeof adminAppSetView === 'function'", timeout=30000)
        page.evaluate("adminAppSetView('list')")
        page.wait_for_selector("text=Dana Delete", timeout=30000)
        row = page.locator("tr", has_text="Dana Delete").first
        row.locator("button:has-text('More')").click()
        page.wait_for_selector("button:has-text('Delete account…')", timeout=10000)
        row.locator("button:has-text('Delete account…')").click()
        page.wait_for_selector(f"#admin-delacct-word-delcr", timeout=10000)
        prompt_txt = page.locator("#admin-delacct-delcr").inner_text()
        R["admin_prompt"] = prompt_txt.replace("\n", " | ")[:240]
        assert "Type DELETE" in prompt_txt, f"admin prompt missing its confirm: {prompt_txt}"
        shot(page, "05-admin-delete-prompt-desktop")
        ctx.close()

    print("QA-DELETION: ALL PASS")
    for k, v in R.items():
        print(f"  {k}: {v}")
finally:
    server.terminate()
