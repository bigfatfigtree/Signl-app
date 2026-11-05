#!/usr/bin/env python3
"""Build -133 rendered QA: the Admin Applications CARD carries
"Delete account…" in its servicing row (Jeff's phone path).
Build -132 shipped the action only in the desktop list row;
Jeff could not find it on the card. CONTENT ASSERTIONS (the
-130 lesson): at 390x844, for BOTH card surfaces that share
adminCardActionsHtml — the deck card (pending creator, prefix
"deck") and the Find-a-user card (approved creator, prefix
"srch", Eva's exact situation) — assert the action row's text
CONTAINS a visible "Delete account…" button, tap it, and
assert the type-DELETE prompt renders in that card's own host.
The erasure itself is never submitted here (proven by
scripts/verify-deletion.mjs).
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build133-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9079
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-133-qa-")
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
putUser({ id: "delpend", role: "creator", email: "delpend@delqa.dev", name: "Pete Pending", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Hampton Roads", city: "Norfolk", createdAt: now, updatedAt: now,
  creator: { handle: "petepending", primaryPlatform: "instagram", followerCount: 4100, totalAudience: 4100, audienceStack: { instagram: 4100 }, categories: ["Coffee"], localAudiencePct: 71, tierBand: "Locals", profileComplete: true, publicPage: false, hasPhoto: false, bio: "" } });
putUser({ id: "delbiz", role: "business", email: "delbiz@delqa.dev", name: "Bob Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: now, updatedAt: now,
  business: { businessName: "Dana's Diner", category: "Restaurant", plan: "self-service", planId: "self-service", about: "Counter diner." } });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-133"
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
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        r = ctx.request.post(BASE + "/api/auth/login", data={"email": "admin@delqa.dev", "password": ADMIN_PW})
        assert r.status == 200, f"admin login {r.status}"
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded")
        page.wait_for_function("() => typeof adminAppSetView === 'function'", timeout=30000)

        # ---------- deck card (pending creator) ----------
        page.evaluate("adminAppSetView('deck')")
        page.wait_for_selector("text=Pete Pending", timeout=30000)
        page.click("button:has-text('More actions')")
        page.wait_for_selector("#admin-deck-actions", state="visible", timeout=10000)
        deck_actions = page.locator("#admin-deck-actions .admin-card-actions")
        deck_txt = deck_actions.inner_text()
        R["deck_row"] = deck_txt.replace("\n", " | ")
        for want in ["View account", "Send sign-in link", "Partner attribution", "Make tester", "View profile", "Delete account…"]:
            assert want in deck_txt, f"deck row missing '{want}': {deck_txt}"
        deck_btn = deck_actions.locator("button:has-text('Delete account…')")
        assert deck_btn.count() == 1 and deck_btn.first.is_visible(), "deck Delete account… not visible"
        deck_btn.first.click()
        page.wait_for_selector("#admin-delacct-word-deck-delpend", state="visible", timeout=10000)
        deck_prompt = page.locator("#admin-delacct-deck-delpend").inner_text()
        R["deck_prompt"] = deck_prompt.replace("\n", " | ")[:240]
        assert "Type DELETE" in deck_prompt, f"deck prompt missing confirm: {deck_prompt}"
        page.locator("#admin-delacct-deck-delpend").scroll_into_view_if_needed()
        page.screenshot(path=os.path.join(OUT, "01-deck-card-delete-390.png"))

        # ---------- Find-a-user card (approved creator) ----------
        page.fill("#admin-user-q", "Dana Delete")
        page.click(".admin-search-panel button:has-text('Search')")
        page.wait_for_selector(".admin-user-card:has-text('Dana Delete')", timeout=30000)
        card = page.locator(".admin-user-card", has_text="Dana Delete").first
        card_actions = card.locator(".admin-card-actions")
        card_txt = card_actions.inner_text()
        R["search_row"] = card_txt.replace("\n", " | ")
        for want in ["View account", "Send sign-in link", "Partner attribution", "Make tester", "View profile", "Delete account…"]:
            assert want in card_txt, f"search card row missing '{want}': {card_txt}"
        card_btn = card_actions.locator("button:has-text('Delete account…')")
        assert card_btn.count() == 1 and card_btn.first.is_visible(), "search card Delete account… not visible"
        card_btn.first.click()
        page.wait_for_selector("#admin-delacct-word-srch-delcr", state="visible", timeout=10000)
        card_prompt = page.locator("#admin-delacct-srch-delcr").inner_text()
        R["search_prompt"] = card_prompt.replace("\n", " | ")[:240]
        assert "Type DELETE" in card_prompt, f"search prompt missing confirm: {card_prompt}"
        page.locator("#admin-delacct-srch-delcr").scroll_into_view_if_needed()
        page.screenshot(path=os.path.join(OUT, "02-search-card-delete-390.png"))

        R["overflow"] = page.evaluate("Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth")
        assert R["overflow"] <= 0, f"390 overflow {R['overflow']}"
        ctx.close()

    print("QA-BUILD133: ALL PASS")
    for k, v in R.items():
        print(f"  {k}: {v}")
finally:
    server.terminate()
