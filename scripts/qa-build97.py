#!/usr/bin/env python3
"""Build -97 Playwright QA: campaign setup and tracking as
two separate views, with Sig-guided setup.

Walks, with real clicks: business Home -> rail "Set up a
campaign" (1 tap) and Home -> rail "Your campaigns" (1 tap);
the manual builder's steps; and a FULL Sig-guided draft
creation on a founding tester business: type the plain-words
request, answer one question at a time (timing is NOT asked:
standing hours are on file), check that no draft exists
before the summary confirmation, confirm, and land on the
new draft in Your campaigns. Desktop + 390px."""
import os, sys, json, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-audit-2026-11-01/fix-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 8988
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b97-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "bizqa", role: "business", email: "biz@b97qa.dev", name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 90 * DAY), updatedAt: iso(now0 - 90 * DAY), phone: "+15550001111", business: { businessName: "B97 QA Brunch House", category: "Restaurant", plan: "growth", planId: "growth", accessState: "founding", about: "Brunch all day, every day.", standingAvailability: { days: ["Fri", "Sat", "Sun"], hours: "12 to 4", appointments: "Tue to Thu by appointment" } } });
data["offer:off-old"] = { id: "off-old", businessId: "bizqa", businessName: "B97 QA Brunch House", status: "draft", kind: "comp", lane: "open", market: "Nashville", category: "Restaurant", title: "Old Draft Special", whatComped: "Meal for two, on us", dollarCap: 80, spots: 2, targetTiers: ["Locals"], deliverables: { posts: 1, story: true, windowHours: 48 }, createdAt: iso(now0 - 5 * DAY), updatedAt: iso(now0 - 5 * DAY) };
data["offer:off-past"] = { id: "off-past", businessId: "bizqa", businessName: "B97 QA Brunch House", status: "closed", kind: "comp", lane: "open", market: "Nashville", category: "Restaurant", title: "Finished Brunch", whatComped: "Brunch for two, on us", dollarCap: 90, spots: 2, targetTiers: ["Locals"], deliverables: { posts: 1, story: true, windowHours: 48 }, createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 20 * DAY) };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE, ADMIN_EMAIL="admin@b97.dev", ADMIN_PASSWORD="<redacted>")
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

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium")

        def login(ctx):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": "biz@b97qa.dev", "password": "qa-pass-1234"})
            return r.status

        def drafts(ctx):
            r = ctx.request.get(BASE + "/api/offers")
            offers = r.json().get("offers", [])
            return [o for o in offers if o.get("status") == "draft"], offers

        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["login"] = login(ctx)
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2200)
        pg.screenshot(path=f"{OUT}/b97-home-desktop.png", full_page=False)

        # ---------- Home -> rail "Set up a campaign" (1 tap) ----------
        pg.click(".tab-item[aria-label='Set up a campaign']")
        pg.wait_for_timeout(1800)
        R["setup_1tap"] = pg.evaluate("""() => ({
          guide: !!document.getElementById('campaign-guide'),
          composer: !!document.getElementById('offer-composer'),
          title: (document.querySelector('.ws-title') || {}).textContent || ''
        })""")
        pg.screenshot(path=f"{OUT}/b97-setup-desktop.png", full_page=False)
        R["setup_overflow"] = pg.evaluate("() => document.scrollingElement.scrollWidth")

        # ---------- the manual builder steps ----------
        R["step1"] = pg.evaluate("() => { const b = document.getElementById('camp-stepbar'); return b ? b.innerText : ''; }")
        pg.evaluate("() => { const el = document.getElementById('offer-composer'); if (el) el.scrollIntoView(); }")
        pg.wait_for_timeout(400)
        pg.screenshot(path=f"{OUT}/b97-builder-step1-desktop.png", full_page=False)
        pg.click("#camp-stepbar button[data-cstep='1']")
        pg.wait_for_timeout(600)
        R["step2"] = pg.evaluate("() => { const b = document.getElementById('camp-stepbar'); return b ? b.innerText : ''; }")
        pg.screenshot(path=f"{OUT}/b97-builder-step2-desktop.png", full_page=False)

        # ---------- the Sig-guided flow, end to end ----------
        pg.evaluate("() => { const el = document.getElementById('campaign-guide'); if (el) el.scrollIntoView(); }")
        pg.wait_for_timeout(300)
        before_drafts, _ = drafts(ctx)
        R["drafts_before"] = [o["title"] for o in before_drafts]
        pg.fill("#cg-text", "I want creators for a weekend brunch push")
        pg.click("#campaign-guide button[type='submit']")
        pg.wait_for_timeout(800)
        R["q1_kind"] = pg.evaluate("() => document.getElementById('cg-thread').innerText.includes('How will the creator be paid?')")
        R["known_line"] = pg.evaluate("() => document.getElementById('cg-thread').innerText.includes('will not ask about those')")
        pg.screenshot(path=f"{OUT}/b97-guide-q1-kind-desktop.png", full_page=False)
        pg.click("#cg-thread button:has-text('Comp')")
        pg.wait_for_timeout(600)
        R["q2_comped"] = pg.evaluate("() => document.getElementById('cg-thread').innerText.includes('Exactly what does the creator get?')")
        pg.fill("#cg-text", "Brunch for two, on us")
        pg.click("#campaign-guide button[type='submit']")
        pg.wait_for_timeout(600)
        R["q3_value"] = pg.evaluate("() => document.getElementById('cg-thread').innerText.includes('What is that worth, in dollars?')")
        pg.screenshot(path=f"{OUT}/b97-guide-q3-value-desktop.png", full_page=False)
        pg.fill("#cg-text", "100")
        pg.click("#campaign-guide button[type='submit']")
        pg.wait_for_timeout(600)
        R["q4_spots"] = pg.evaluate("() => document.getElementById('cg-thread').innerText.includes('How many creators do you want')")
        pg.click("#cg-thread button:has-text('3')")
        pg.wait_for_timeout(600)
        thread_now = pg.evaluate("() => document.getElementById('cg-thread').innerText")
        R["dates_not_asked"] = ("When should creators come in?" not in thread_now)
        R["q5_deliverables"] = ("What the creator owes:" in thread_now)
        pg.screenshot(path=f"{OUT}/b97-guide-q5-deliverables-desktop.png", full_page=False)
        pg.click("#cg-thread button:has-text('Keep as shown')")
        pg.wait_for_timeout(600)
        R["q6_fit"] = pg.evaluate("() => document.getElementById('cg-thread').innerText.includes('Who fits this campaign?')")
        pg.click("#cg-thread button:has-text('Done')")
        pg.wait_for_timeout(600)
        summary = pg.evaluate("() => document.getElementById('cg-thread').innerText")
        R["summary_shows_all"] = all(s in summary for s in ["Here is your draft", "Weekend brunch push", "Brunch for two, on us", "3 spots", "1 post + 1 story", "Nothing is saved until you tap Save this draft"])
        mid_drafts, _ = drafts(ctx)
        R["no_draft_before_confirm"] = len(mid_drafts) == len(before_drafts)
        pg.screenshot(path=f"{OUT}/b97-guide-summary-desktop.png", full_page=False)
        pg.click("#cg-thread button:has-text('Save this draft')")
        pg.wait_for_timeout(1200)
        after_drafts, _ = drafts(ctx)
        R["draft_created_once"] = len(after_drafts) == len(before_drafts) + 1 and any(o["title"] == "Weekend brunch push" for o in after_drafts)
        R["done_line"] = pg.evaluate("() => document.getElementById('cg-thread').innerText.includes('is a draft in Your campaigns')")
        pg.screenshot(path=f"{OUT}/b97-guide-done-desktop.png", full_page=False)

        # ---------- land on the draft in Your campaigns ----------
        pg.click("#cg-thread button:has-text('See it in Your campaigns')")
        pg.wait_for_timeout(1800)
        R["tracking_shows_new_draft"] = pg.evaluate("""() => {
          const t = document.body.innerText;
          return { title: (document.querySelector('.ws-title') || {}).textContent || '', draft: t.includes('Weekend brunch push'), old: t.includes('Old Draft Special') };
        }""")
        pg.screenshot(path=f"{OUT}/b97-tracking-desktop.png", full_page=False)

        # ---------- Home -> rail "Your campaigns" (1 tap), past list ----------
        pg.click(".tab-item[aria-label='Home']")
        pg.wait_for_timeout(1500)
        pg.click(".tab-item[aria-label='Your campaigns']")
        pg.wait_for_timeout(1500)
        pg.click(".ws-tab:has-text('Past')")
        pg.wait_for_timeout(900)
        R["past_shows_finished"] = pg.evaluate("() => document.body.innerText.includes('Finished Brunch')")
        pg.screenshot(path=f"{OUT}/b97-tracking-past-desktop.png", full_page=False)
        ctx.close()

        # ---------- mobile 390px ----------
        ctxm = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        pgm = ctxm.new_page()
        login(ctxm)
        pgm.goto(BASE + "/", wait_until="networkidle"); pgm.wait_for_timeout(2200)
        pgm.click(".tab-item[aria-label='Set up a campaign']")
        pgm.wait_for_timeout(1800)
        R["mobile_setup"] = pgm.evaluate("() => !!document.getElementById('campaign-guide')")
        R["mobile_overflow_setup"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        pgm.screenshot(path=f"{OUT}/b97-setup-mobile.png", full_page=False)
        pgm.click(".tab-item[aria-label='Your campaigns']")
        pgm.wait_for_timeout(1800)
        R["mobile_tracking"] = pgm.evaluate("() => document.body.innerText.includes('Weekend brunch push') || document.body.innerText.includes('Drafts')")
        R["mobile_overflow_tracking"] = pgm.evaluate("() => document.scrollingElement.scrollWidth")
        pgm.screenshot(path=f"{OUT}/b97-tracking-mobile.png", full_page=False)
        ctxm.close()
        b.close()
finally:
    server.terminate()

print(json.dumps(R, indent=1))
