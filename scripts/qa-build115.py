#!/usr/bin/env python3
"""Build -115 Playwright QA:
- Approval email HTML (new shorter copy in the -114 branded
  wrapper) at 1280px and 390px: logo renders, no overflow.
- Creator (390px): founding Offers empty state for a complete
  creator with a paid rate now carries the invite action (no
  dead end); the Profile form save shows its "Saved." confirm.
- Business (390px): the Profile "Save basics" card save shows
  its "Saved." note. (The founding ZIP form's preview host is
  not emitted by any current render path, so that surface is
  not reachable to shoot; its save still got the toast fix.)
Overflow checked at every width."""
import os, sys, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build115-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9060
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b115-qa-")
db = os.path.join(tmp, "db.json")

# The approval email HTML, from the real builders.
gen_js = r"""
process.env.SIGNL_MAIL_STUB = "1";
const fs = require("fs");
const router = require(process.argv[2] + "/netlify/functions/lib/router.js");
const { brandedEmailHtml } = require(process.argv[2] + "/netlify/functions/lib/email.js");
const u = { name: "Quick Claim", email: "q@fixtures.dev", market: "Hampton Roads", city: "Norfolk", creator: { handle: "quickclaim757", tierBand: "Locals", categories: ["Food & Drink"], localAudiencePct: 55, audienceStack: { instagram: 3000 }, followerCount: 3000, totalAudience: 3000, bestWork: [], bio: "", hasPhoto: false, neighborhood: "" } };
const mail = router.approvalEmail(u, 100);
fs.writeFileSync(process.argv[3], brandedEmailHtml(mail.text));
console.log("words:", mail.text.split(/\s+/).filter(Boolean).length);
"""
gen_path = os.path.join(tmp, "gen.cjs")
open(gen_path, "w").write(gen_js)
email_html = os.path.join(tmp, "approval-email.html")
print(subprocess.run(["node", gen_path, ROOT, email_html], capture_output=True, text=True).stdout.strip())

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "cr115", role: "creator", email: "cr@b115qa.dev", name: "Casey Complete", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 10 * DAY), reviewedAt: iso(now0 - 9 * DAY), creator: { handle: "qa115eats", primaryPlatform: "instagram", followerCount: 3000, totalAudience: 3000, audienceStack: { instagram: 3000 }, categories: ["Food & Drink"], localAudiencePct: 55, tierBand: "Locals", profileComplete: true, hasPhoto: true, paidRate: 150, publicPage: true, bio: "Norfolk food and drink, every week." } });
putUser({ id: "biz115", role: "business", email: "biz@b115qa.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Norfolk", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 30 * DAY), business: { businessName: "QA115 Test Kitchen", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Counter service tacos and brunch." } });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
R = {}
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    logo_bytes = open(os.path.join(ROOT, "public/assets/logo.png"), "rb").read()

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium")

        def overflow(page):
            return page.evaluate("Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth")

        # ---- approval email, desktop + phone ----
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        pg.route("https://app.joinsignl.com/assets/logo.png", lambda r: r.fulfill(body=logo_bytes, content_type="image/png"))
        pg.goto("file://" + email_html)
        pg.wait_for_timeout(600)
        R["email_desktop_overflow"] = overflow(pg)
        R["email_logo_loaded"] = pg.evaluate("(() => { const i = document.querySelector('img'); return i ? i.naturalWidth : 0; })()")
        pg.screenshot(path=os.path.join(OUT, "email-desktop.png"), full_page=True)
        pg.set_viewport_size({"width": 390, "height": 844})
        pg.wait_for_timeout(400)
        R["email_mobile_overflow"] = overflow(pg)
        pg.screenshot(path=os.path.join(OUT, "email-mobile.png"), full_page=True)
        ctx.close()

        def login(email):
            c = b.new_context(viewport={"width": 390, "height": 844})
            r = c.request.post(BASE + "/api/auth/login", data={"email": email, "password": "qa-pass-1234"})
            assert r.status == 200, f"login {email}: {r.status}"
            page = c.new_page()
            page.goto(BASE + "/")
            page.wait_for_timeout(1200)
            return c, page

        def click_nav(page, label):
            hit = page.evaluate("""(label) => {
              const el = document.querySelector(`.rail-item[aria-label="${label}"], .tab-item[aria-label="${label}"]`);
              if (el) { el.click(); return true; }
              return false;
            }""", label)
            if hit:
                page.wait_for_timeout(600)
                return "aria-click"
            raise RuntimeError(f"nav not found: {label}")

        # ---- creator: Offers empty state + Profile save confirm ----
        cctx, cpage = login("cr@b115qa.dev")
        click_nav(cpage, "Offers")
        cpage.wait_for_selector(".founding-empty", timeout=8000)
        cpage.wait_for_timeout(500)
        body_text = cpage.inner_text("body")
        R["offers_empty_has_invite_action"] = "Share your invite" in body_text
        R["offers_empty_profile_complete_line"] = "Your profile is complete and your paid rate is set" in body_text
        R["offers_mobile_overflow"] = overflow(cpage)
        cpage.screenshot(path=os.path.join(OUT, "creator-offers-empty-390.png"), full_page=True)
        click_nav(cpage, "My profile")
        cpage.wait_for_timeout(1200)
        cpage.click("button[type=submit].btn, .save-bar button[type=submit]", timeout=6000)
        cpage.wait_for_function("() => { const el = document.getElementById('save-ok'); return el && el.textContent.includes('Saved.'); }", timeout=8000)
        R["creator_profile_save_confirmed"] = True
        cpage.screenshot(path=os.path.join(OUT, "creator-profile-saved-390.png"), full_page=True)
        cctx.close()

        # ---- business: Profile card save shows its Saved. note ----
        bctx, bpage = login("biz@b115qa.dev")
        try:
            click_nav(bpage, "Profile")
        except RuntimeError:
            bpage.evaluate("go('dashboard','Profile')")
            bpage.wait_for_timeout(800)
        bpage.wait_for_selector("text=Save basics", timeout=8000)
        bpage.click("text=Save basics", timeout=6000)
        bpage.wait_for_function("() => { const el = document.getElementById('bp-ok'); return el && el.textContent.includes('Saved.'); }", timeout=8000)
        R["business_profile_save_confirmed"] = True
        bpage.wait_for_timeout(300)
        R["business_mobile_overflow"] = overflow(bpage)
        bpage.screenshot(path=os.path.join(OUT, "business-profile-saved-390.png"), full_page=True)
        bctx.close()
        b.close()
finally:
    server.terminate()

print(json.dumps(R, indent=1) if (json := __import__("json")) else R)
