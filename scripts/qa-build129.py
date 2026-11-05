#!/usr/bin/env python3
"""Build -129 rendered QA (Jeff, 2026-11-04, the Zamp Camp case):
  * Claim flow via a Tampa claim link: welcome screen carries the
    plain "your invite picked this market" line; facts screen has
    Tampa pre-picked, the change-it-here explainer, and the market
    select is EDITABLE (switch it to Charlotte on camera).
  * Profile "Your market" control: approved Tampa creator sees
    the picker (not the old "cannot be changed here" dead end),
    saves Charlotte + Charlotte city through the real UI, lands
    on the visible confirmation, header + city picker now read
    Charlotte, and her audience numbers render preserved
    (home % now 30, Tampa listed as an other market at 55).
  * Desktop 1280 + phone 390 screenshots of every touched
    screen; overflow audit at 390 on Profile and claim facts.
Output: ~/workspace/research_notes/signl-build129-qa/
"""
import os, sys, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build129-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9081
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b129-qa-")
db = os.path.join(tmp, "db.json")
PW = "qa-pass-1234"
fails = []

def check(name, cond, extra=""):
    print(("  ok " if cond else "FAIL ") + name + ((" :: " + str(extra)[:240]) if (extra and not cond) else ""))
    if not cond:
        fails.append(name)

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
data["config:markets"] = { flags: {} };
putUser({ id: "jamie", role: "creator", email: "jamie@b129.dev", name: "Jamie Zamp", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Tampa", city: "Tampa", createdAt: iso(now0 - 12 * DAY), updatedAt: iso(now0 - 1 * DAY),
  creator: { handle: "the_zamp_camp", primaryPlatform: "instagram", followerCount: 23700, totalAudience: 23700, audienceStack: { instagram: 23700 }, audienceMarkets: [{ market: "Charlotte", pct: 30 }, { market: "Austin", pct: 10 }], categories: ["Lifestyle"], localAudiencePct: 55, localAudienceSource: "Self-reported", tierBand: "Headliners", profileComplete: true, hasPhoto: false, publicPage: true, bio: "Charlotte family life, filed under Tampa by a bad invite link." } });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1", SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b129.dev"
env["ADMIN_PASSWORD"] = "qa-admin-pass-129"
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

OVERFLOW_JS = r"""() => {
  const iw = window.innerWidth;
  const docSW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  return { iw, docSW, excess: docSW - iw };
}"""

def new_ctx(b, w=1280, h=900):
    return b.new_context(viewport={"width": w, "height": h}, ignore_https_errors=True,
                         has_touch=(w < 768), is_mobile=(w < 768), device_scale_factor=3 if w < 768 else 1)

def login(ctx, email, pw):
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
    assert r.status == 200, f"login {email}: {r.status}"
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(900)
    return page

try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        # ---------- Claim flow: the Tampa link ----------
        ctx = new_ctx(b, 1280, 900)
        page = ctx.new_page()
        page.goto(BASE + "/claim?handle=the_zamp_camp&market=Tampa&src=email", wait_until="networkidle")
        page.wait_for_timeout(1200)
        body = page.inner_text("body")
        check("claim welcome shows the invite-picked-market line", "Your invite picked the market shown with your name" in body)
        check("claim welcome identity shows Tampa", "Tampa" in body)
        page.screenshot(path=os.path.join(OUT, "01-claim-welcome-tampa-desktop.png"), full_page=True)
        page.click("text=Claim my page")
        page.wait_for_timeout(900)
        mval = page.eval_on_selector("#c85-market", "el => el.value")
        check("claim facts pre-picks the link's market (Tampa)", mval == "Tampa", mval)
        body = page.inner_text("body")
        check("claim facts carries the change-it explainer", "Your invite picked this market." in body and "You can change it later, any time, in your profile." in body)
        page.select_option("#c85-market", "Charlotte")
        page.wait_for_timeout(500)
        mval2 = page.eval_on_selector("#c85-market", "el => el.value")
        cval2 = page.eval_on_selector("#c85-city", "el => el.value")
        check("claim facts market is EDITABLE before submit (now Charlotte, city list follows)", mval2 == "Charlotte" and bool(cval2), f"{mval2}/{cval2}")
        page.screenshot(path=os.path.join(OUT, "02-claim-facts-edited-charlotte-desktop.png"), full_page=True)
        ctx.close()

        ctx = new_ctx(b, 390, 844)
        page = ctx.new_page()
        page.goto(BASE + "/claim?handle=the_zamp_camp&market=Tampa&src=email", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.screenshot(path=os.path.join(OUT, "03-claim-welcome-tampa-390.png"), full_page=True)
        page.click("text=Claim my page")
        page.wait_for_timeout(900)
        ov = page.evaluate(OVERFLOW_JS)
        check("claim facts no horizontal overflow at 390", ov["excess"] <= 1, ov)
        page.screenshot(path=os.path.join(OUT, "04-claim-facts-tampa-390.png"), full_page=True)
        ctx.close()

        # ---------- Profile: the fix, phone first (Tampa state) ----------
        ctx = new_ctx(b, 390, 844)
        page = login(ctx, "jamie@b129.dev", PW)
        page.evaluate("go('dashboard','Profile')")
        page.wait_for_timeout(1400)
        body = page.inner_text("body")
        check("profile shows the Your market control", "Your market" in body and "Save market" in body)
        check("old dead-end line is gone", "cannot be changed here" not in body)
        pm = page.eval_on_selector("#p-market", "el => el.value")
        check("profile picker starts on Tampa", pm == "Tampa", pm)
        ov = page.evaluate(OVERFLOW_JS)
        check("profile no horizontal overflow at 390", ov["excess"] <= 1, ov)
        page.screenshot(path=os.path.join(OUT, "05-profile-market-control-390.png"), full_page=True)
        ctx.close()

        # ---------- Profile: desktop, perform the move ----------
        ctx = new_ctx(b, 1280, 900)
        page = login(ctx, "jamie@b129.dev", PW)
        page.evaluate("go('dashboard','Profile')")
        page.wait_for_timeout(1400)
        page.screenshot(path=os.path.join(OUT, "06-profile-market-control-desktop.png"), full_page=True)
        page.select_option("#p-market", "Charlotte")
        page.wait_for_timeout(400)
        cities = page.eval_on_selector("#p-market-city", "el => Array.from(el.options).map(o => o.value)")
        check("city picker rebuilds to Charlotte's cities", "Charlotte" in cities and "Matthews" in cities, cities[:5])
        page.select_option("#p-market-city", "Charlotte")
        page.click("text=Save market")
        page.wait_for_timeout(1600)
        body = page.inner_text("body")
        check("visible confirmation after save", "Saved. Your market is now Charlotte" in body)
        hdr = page.evaluate("""() => Array.from(document.querySelectorAll('p')).some((e) => e.textContent.trim().startsWith('Charlotte, North Carolina'))""")
        check("header place line now reads Charlotte, North Carolina", hdr)
        pm2 = page.eval_on_selector("#p-market", "el => el.value")
        check("picker now sits on Charlotte", pm2 == "Charlotte", pm2)
        pct = page.eval_on_selector("#p-localpct", "el => el.value")
        check("home local % is now her Charlotte share (30)", pct == "30", pct)
        amrows = page.evaluate("""() => Array.from(document.querySelectorAll('#p-am-rows .p-am-row')).map((r) => [r.querySelector('.p-am-market').value, r.querySelector('.p-am-pct').value])""")
        check("Tampa rides along as an other-market row at 55%, Austin kept at 10%", ["Tampa", "55"] in amrows and ["Austin", "10"] in amrows, amrows)
        page.screenshot(path=os.path.join(OUT, "07-profile-after-move-desktop.png"), full_page=True)

        # ---------- Sig does the same move in chat ----------
        page.evaluate("go('dashboard','Sig')")
        page.wait_for_timeout(1400)
        page.fill("#sig-ask-input", "change my market")
        page.press("#sig-ask-input", "Enter")
        page.wait_for_timeout(900)
        thread = page.inner_text("#sig-thread")
        check("Sig opens the market flow naming the current market", "Your market is Charlotte right now" in thread)
        page.fill("#sig-ask-input", "Austin")
        page.press("#sig-ask-input", "Enter")
        page.wait_for_timeout(900)
        thread = page.inner_text("#sig-thread")
        check("Sig asks the home city in the new market", "Which city in Austin is home?" in thread)
        page.fill("#sig-ask-input", "Austin")
        page.press("#sig-ask-input", "Enter")
        page.wait_for_timeout(900)
        thread = page.inner_text("#sig-thread")
        check("Sig confirms before writing", "Move your market from Charlotte to Austin" in thread)
        page.click("#sig-thread >> text=Yes, move my market")
        page.wait_for_timeout(1600)
        thread = page.inner_text("#sig-thread")
        check("Sig completes the move and says so", "Done. Your market is now Austin, home city Austin." in thread)
        page.screenshot(path=os.path.join(OUT, "08-sig-market-move-desktop.png"), full_page=True)
        page.evaluate("go('dashboard','Profile')")
        page.wait_for_timeout(1400)
        pm3 = page.eval_on_selector("#p-market", "el => el.value")
        pct3 = page.eval_on_selector("#p-localpct", "el => el.value")
        check("profile agrees after the Sig move (Austin, home % is her reported Austin share 10)", pm3 == "Austin" and pct3 == "10", f"{pm3}/{pct3}")
        ctx.close()

        b.close()
finally:
    server.kill()

print(f"\nQA build129: {'ALL OK' if not fails else 'FAILURES: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
