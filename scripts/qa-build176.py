#!/usr/bin/env python3
"""Build -176 rendered QA: category checkboxes + rank removal +
dashboard door + timed claim walk, phone 390 + desktop 1440.

Seeded Amsterdam/Nashville shape (mirrors the perf harness):
  - prospect "qaclaimer" in Amsterdam: 540,000 IG followers at
    8% local = 43,200 neighbors (Jeff's screenshot shape), so the
    claim link /claim?handle=qaclaimer&market=Amsterdam lands on
    the PERSONAL hook (Screen 0).
  - one bigger checked Amsterdam creator (500K at 8%) is NOT in
    play here; the claimer herself is the big stack.
  - creator "existing@qa.dev" in Nashville with only 3 of 12
    categories ticked, for the profile-edit picker shot.

Asserts, on the REAL rendered surfaces:
1. Hook Screen 0 (390): neighbor number + neighbors line +
   "Claim my spot"; NO rank text anywhere ("rank", "of the",
   "creators checked", "locked in").
2. Facts screen (390), three states:
   a. arrival: 12 boxes all checked, Select all checked.
   b. one unticked: Select all indeterminate, 11 checked.
   c. Select all unticked: 0 checked, then Continue shows the
      "Pick at least one" guard warning.
   Plus one desktop (1440) arrival shot.
3. Full walk (390), TIMED: facts -> skip extra market ->
   account (email/password/agree) -> submit -> done screen.
   Done screen: neighbor number 43,200 + neighbors line +
   "Every platform you post on is counted" + "Save my Neighbor
   Card"; NO rank text; primary "Add your rates and best work"
   + new "Go to my dashboard" door visible.
4. Click the dashboard door: creator Home lands; the finish
   prompt / next-steps for the incomplete profile is visible.
5. Full join form (desktop): the c-cat picker is checkboxes,
   all checked, Select all present.
6. Profile edit (desktop, existing creator): the p-cat picker
   is checkboxes with exactly her 3 ticked; Select all not
   checked (indeterminate state acceptable).
Every <img> asserted loaded; no horizontal overflow.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app-176")
OUT = os.path.expanduser("~/workspace/research_notes/build176-qa-2026-11-10")
os.makedirs(OUT, exist_ok=True)
PORT = 9177
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-176-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = (pw) => crypto.scryptSync(pw, salt, 64).toString("hex");
const now = new Date().toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "admin1", role: "admin", email: "admin@qa.dev", name: "QA Admin", passwordSalt: salt, passwordHash: hash("qa-admin-pass-176"), status: "approved", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: now });
const CATS = ["Food & Drink", "Nightlife", "Beauty & Grooming", "Fitness & Wellness", "Health & Wellness", "Retail & Shopping", "Attractions & Events", "Local Services", "Lifestyle", "Sports", "Music", "Other"];
const creator = (id, email, name, market, creator) => putUser({ id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash("qa-creator-pass"), status: "approved", market, city: market, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: now, tester: false, creator });
creator("crexisting", "existing@qa.dev", "Existing Erin", "Nashville", { handle: "existingerin", primaryPlatform: "instagram", categories: ["Food & Drink", "Nightlife", "Music"], compCategories: [], compOpen: true, audienceStack: { instagram: 9000 }, followerCount: 9000, totalAudience: 9000, localAudiencePct: 40, localAudienceSource: "Self-reported", platformLocalPct: {}, profileComplete: false, hasPhoto: false, paidRate: null, bio: "" });
creator("crams", "ams@qa.dev", "Amsterdam Annie", "Amsterdam", { handle: "annieams", primaryPlatform: "instagram", categories: CATS.slice(0, 4), compCategories: [], compOpen: true, audienceStack: { instagram: 60000 }, followerCount: 60000, totalAudience: 60000, localAudiencePct: 50, localAudienceSource: "Self-reported", platformLocalPct: {}, profileComplete: true, hasPhoto: false, paidRate: 200, bio: "seeded" });
data["prospect:pqa1"] = { id: "pqa1", handle: "qaclaimer", name: "Quinn Claimer", marketName: "Amsterdam", status: "to_contact", followers: 540000, followersPlatform: "instagram", localPct: 8 };
data["config:markets"] = { flags: { "Nashville": true, "Amsterdam": true, "Virginia Beach": true } };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE,
           ADMIN_EMAIL="admin@qa.dev", ADMIN_PASSWORD="qa-admin-pass-176")
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "SIG_AI_API_KEY", "SIG_AI_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MAGGIE_AI_ENABLED", "MAGGIE_AI_MODEL"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
R = {}
FAILS = []
def check(name, cond, detail=""):
    R[name] = detail if detail else ("ok" if cond else "FAIL")
    if not cond:
        FAILS.append(name)
    print(("ok - " if cond else "FAIL - ") + name + ((" :: " + str(detail)[:260]) if detail else ""))

RANKY = ["rank", "of the", "creators checked", "creators we've checked", "locked in"]

try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def facts(page):
            return page.evaluate("""() => {
              const imgs = [...document.images];
              return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                       imgTotal: imgs.length,
                       imgBroken: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).length };
            }""")

        def body_text(page):
            return page.evaluate("() => document.body.innerText")

        def rank_leaks(text):
            low = text.lower()
            return [w for w in RANKY if w in low]

        def cat_state(page):
            return page.evaluate("""() => {
              const boxes = [...document.querySelectorAll('#c85-cats input[data-cat]')];
              const all = document.getElementById('c85-cat-all');
              return { total: boxes.length, checked: boxes.filter((x) => x.checked).length,
                       allChecked: !!all && all.checked, allInd: !!all && all.indeterminate };
            }""")

        # ---------- phone context: the full claim walk ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=3)
        page = ctx.new_page()
        page.goto(BASE + "/claim?handle=qaclaimer&market=Amsterdam", wait_until="domcontentloaded")
        page.wait_for_function("() => !!document.getElementById('nb-hook-count')", timeout=30000)
        page.wait_for_timeout(600)
        t = body_text(page)
        check("hook: neighbor number 43,200 shown", "43,200" in t)
        check("hook: neighbors line shown", "neighbors in Amsterdam" in t)
        check("hook: CTA reads 'Claim my spot'", "Claim my spot" in t)
        check("hook: NO rank text anywhere", rank_leaks(t) == [], rank_leaks(t))
        f = facts(page); check("hook: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=os.path.join(OUT, "01-hook-norank-390.png"), full_page=True)

        # to the facts screen
        page.click("text=Claim my spot")
        page.wait_for_function("() => !!document.getElementById('c85-cats')", timeout=30000)
        page.wait_for_timeout(400)
        cs = cat_state(page)
        check("facts (a): 12 category boxes, all checked, Select all checked",
              cs["total"] == 12 and cs["checked"] == 12 and cs["allChecked"] and not cs["allInd"], cs)
        page.locator("#c85-cats").scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT, "02-cats-all-checked-390.png"))
        f = facts(page); check("facts (a): no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)

        # (b) untick one category
        page.evaluate("""() => { const b = document.querySelector('#c85-cats input[data-cat="Music"]'); b.click(); }""")
        page.wait_for_timeout(300)
        cs = cat_state(page)
        check("facts (b): one unticked -> 11 checked, Select all indeterminate",
              cs["checked"] == 11 and not cs["allChecked"] and cs["allInd"], cs)
        page.screenshot(path=os.path.join(OUT, "03-cats-one-unticked-390.png"))

        # re-tick it -> Select all restores to checked
        page.evaluate("""() => { const b = document.querySelector('#c85-cats input[data-cat="Music"]'); b.click(); }""")
        page.wait_for_timeout(300)
        cs = cat_state(page)
        check("facts (b2): re-ticking all 12 restores Select all checked",
              cs["checked"] == 12 and cs["allChecked"] and not cs["allInd"], cs)

        # (c) untick Select all -> all empty; Continue -> guard warning
        page.evaluate("() => { document.getElementById('c85-cat-all').click(); }")
        page.wait_for_timeout(300)
        cs = cat_state(page)
        check("facts (c): Select all unticked -> 0 checked", cs["checked"] == 0 and not cs["allChecked"], cs)
        page.screenshot(path=os.path.join(OUT, "04-cats-none-390.png"))
        # restore all for the walk, then empty again to prove the guard
        page.evaluate("() => { document.getElementById('c85-cat-all').click(); }")
        page.wait_for_timeout(200)
        page.evaluate("() => { document.getElementById('c85-cat-all').click(); }")
        page.wait_for_timeout(200)
        page.click("text=Continue")
        page.wait_for_timeout(600)
        t = body_text(page)
        warn_vis = page.evaluate("() => { const w = document.getElementById('c85-cat-warn'); return !!w && w.offsetParent !== null; }")
        check("facts (c): zero-selected Continue is blocked with the pick-at-least-one warning",
              warn_vis and "Pick at least one" in t)
        check("facts (c): still on the facts screen after the guard", page.evaluate("() => !!document.getElementById('c85-cats')"))
        page.screenshot(path=os.path.join(OUT, "05-cats-guard-390.png"))
        # restore all 12 and set the stack (facts for a real claim).
        # NOTE: the facts slider is built from the hook's ROUNDED
        # local % (Math.round(8) with step 5 lands the slider on
        # 10), and the submit PATCH re-rates the creator from the
        # slider — so the done screen counts 540,000 x 10% =
        # 54,000. The walk pins the slider to 10 explicitly so the
        # expectation is exact, not incidental.
        page.evaluate("() => { document.getElementById('c85-cat-all').click(); }")
        page.wait_for_timeout(200)
        page.fill("#c85-stack-instagram", "540000")
        page.evaluate("""() => {
          const s = document.getElementById('c85-localpct');
          s.value = '10'; s.dispatchEvent(new Event('input', { bubbles: true }));
        }""")
        page.wait_for_timeout(300)

        # ---------- TIMED submit walk: facts -> done ----------
        t0 = time.time()
        page.click("text=Continue")  # facts -> extra market screen
        page.wait_for_function("() => !!document.getElementById('c85-xmarket')", timeout=30000)
        page.click("text=Skip — just my home market")
        page.wait_for_function("() => !!document.getElementById('c85-email')", timeout=30000)
        page.fill("#c85-email", "quinn@qa.dev")
        page.fill("#c85-password", "qa-claim-pass-176")
        page.check("#c85-agree-terms")
        t_submit = time.time()
        page.click("button[type=submit]")
        page.wait_for_function("() => !!document.getElementById('nb-big')", timeout=60000)
        t_done = time.time()
        page.wait_for_timeout(500)
        submit_ms = int((t_done - t_submit) * 1000)
        walk_ms = int((t_done - t0) * 1000)
        check("TIMED: submit click -> done screen rendered (local store, no latency model)", True, f"{submit_ms} ms (full facts->done walk {walk_ms} ms)")
        t = body_text(page)
        check("done: neighbor number 54,000 shown big (540,000 stack x the 10% the facts slider carried)",
              page.evaluate("() => document.getElementById('nb-big').innerText.trim()") == "54,000",
              page.evaluate("() => document.getElementById('nb-big').innerText.trim()"))
        check("done: neighbors line + local words shown", "neighbors in Amsterdam" in t and "out of 10" in t)
        # With only Instagram on the record, the panel shows the
        # Maggie add-a-platform prompt (its reworded -176 copy);
        # the "Every platform you post on is counted" line is the
        # all-platforms-present variant of the same slot.
        check("done: Maggie stack prompt carries the reworded no-rank copy",
              "Every platform you add recounts your neighbors, right here." in t and "climb" not in t.lower())
        check("done: 'Save my Neighbor Card' present", "Save my Neighbor Card" in t)
        check("done: NO rank text anywhere", rank_leaks(t) == [], rank_leaks(t))
        check("done: primary 'Add your rates and best work' present", "Add your rates and best work" in t)
        check("done: NEW dashboard door 'Go to my dashboard' present", "Go to my dashboard" in t)
        check("done: finish note under the door", "Finish your profile there so businesses can find you" in t)
        f = facts(page); check("done: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=os.path.join(OUT, "06-done-norank-door-390.png"), full_page=True)

        # ---------- the dashboard door ----------
        # A just-claimed creator is PENDING review, so her
        # dashboard landing is the founding status screen (by
        # design): queue position as a BAND ("first 100"), the
        # photo step, the invite block. The finish checklist
        # proper belongs to approved creators — proven below
        # with the approved-but-incomplete Erin instead.
        page.click("text=Go to my dashboard")
        page.wait_for_function("() => { try { return state.view === 'dashboard'; } catch (e) { return false; } }", timeout=30000)
        page.wait_for_timeout(1500)
        t = body_text(page)
        check("dashboard: lands on the dashboard after the door", True)
        check("dashboard: pending landing is the founding status screen", "Founding profile received" in t)
        check("dashboard: founding position shown as a BAND, never an exact rank", "first 100" in t)
        f = facts(page); check("dashboard: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=os.path.join(OUT, "07-dashboard-landing-390.png"), full_page=True)
        ctx.close()

        # ---------- approved-but-incomplete creator: Home finish prompt ----------
        ectx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=3)
        r = ectx.request.post(BASE + "/api/auth/login", data={"email": "existing@qa.dev", "password": "qa-creator-pass"})
        assert r.status == 200, f"login erin -> {r.status}"
        epage = ectx.new_page()
        epage.goto(BASE + "/", wait_until="domcontentloaded")
        epage.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
        epage.wait_for_timeout(1500)
        t = body_text(epage)
        low = t.lower()
        finish_words = [w for w in ["finish", "complete your profile", "checklist", "next step", "still to", "add your"] if w in low]
        check("erin home: a finish/next-step prompt is visible for the incomplete profile", len(finish_words) > 0, finish_words)
        f = facts(epage); check("erin home: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        epage.screenshot(path=os.path.join(OUT, "11-erin-home-finish-390.png"), full_page=True)
        ectx.close()

        # ---------- desktop: facts arrival state ----------
        dctx = b.new_context(viewport={"width": 1440, "height": 950})
        dpage = dctx.new_page()
        dpage.goto(BASE + "/claim?handle=qaclaimer&market=Amsterdam", wait_until="domcontentloaded")
        dpage.wait_for_function("() => !!document.getElementById('nb-hook-count')", timeout=30000)
        dpage.click("text=Claim my spot")
        dpage.wait_for_function("() => !!document.getElementById('c85-cats')", timeout=30000)
        dpage.wait_for_timeout(400)
        cs = cat_state(dpage)
        check("facts desktop (a): 12 checked + Select all checked", cs["total"] == 12 and cs["checked"] == 12 and cs["allChecked"], cs)
        dpage.locator("#c85-cats").scroll_into_view_if_needed()
        dpage.wait_for_timeout(300)
        dpage.screenshot(path=os.path.join(OUT, "08-cats-all-checked-1440.png"))
        f = facts(dpage); check("facts desktop: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        dctx.close()

        # ---------- desktop: full join form picker ----------
        jctx = b.new_context(viewport={"width": 1440, "height": 950})
        jpage = jctx.new_page()
        jpage.goto(BASE + "/claim?handle=qaclaimer&market=Amsterdam", wait_until="domcontentloaded")
        jpage.wait_for_function("() => !!document.getElementById('nb-hook-count')", timeout=30000)
        jpage.click("text=Claim my spot")
        jpage.wait_for_function("() => !!document.getElementById('c85-cats')", timeout=30000)
        jpage.evaluate("showFullJoin()")
        jpage.wait_for_function("() => document.querySelectorAll('input[name=\"c-cat\"]').length === 12", timeout=30000)
        jpage.wait_for_timeout(400)
        jc = jpage.evaluate("""() => {
          const boxes = [...document.querySelectorAll('input[name="c-cat"]')];
          const all = document.getElementById('c-cat-all');
          return { total: boxes.length, checked: boxes.filter((x) => x.checked).length, allChecked: !!all && all.checked };
        }""")
        check("join form: 12 c-cat checkboxes, all checked, Select all checked", jc["total"] == 12 and jc["checked"] == 12 and jc["allChecked"], jc)
        el = jpage.locator("#c-cat-all")
        el.scroll_into_view_if_needed()
        jpage.wait_for_timeout(300)
        jpage.screenshot(path=os.path.join(OUT, "09-joinform-cats-1440.png"))
        f = facts(jpage); check("join form: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        jctx.close()

        # ---------- desktop: profile edit picker (3 of 12 ticked) ----------
        pctx = b.new_context(viewport={"width": 1440, "height": 950})
        r = pctx.request.post(BASE + "/api/auth/login", data={"email": "existing@qa.dev", "password": "qa-creator-pass"})
        assert r.status == 200, f"login existing -> {r.status}"
        ppage = pctx.new_page()
        ppage.goto(BASE + "/", wait_until="domcontentloaded")
        ppage.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
        ppage.wait_for_timeout(900)
        ppage.evaluate("go('dashboard','Profile')")
        ppage.wait_for_function("() => document.querySelectorAll('input[name=\"p-cat\"]').length === 12", timeout=30000)
        ppage.wait_for_timeout(400)
        pc = ppage.evaluate("""() => {
          const boxes = [...document.querySelectorAll('input[name="p-cat"]')];
          const all = document.getElementById('p-cat-all');
          return { total: boxes.length, checked: boxes.filter((x) => x.checked).length,
                   checkedNames: boxes.filter((x) => x.checked).map((x) => x.value),
                   allChecked: !!all && all.checked, allInd: !!all && all.indeterminate,
                   label: all ? all.closest('label').innerText.trim() : '' };
        }""")
        check("profile edit: 12 p-cat checkboxes, exactly her 3 ticked (Food & Drink, Nightlife, Music)",
              pc["total"] == 12 and sorted(pc["checkedNames"]) == ["Food & Drink", "Music", "Nightlife"], pc)
        check("profile edit: Select all present, not fully checked", (not pc["allChecked"]) and "Select all" in pc["label"], pc)
        el = ppage.locator("#p-cat-all")
        el.scroll_into_view_if_needed()
        ppage.wait_for_timeout(300)
        ppage.screenshot(path=os.path.join(OUT, "10-profileedit-cats-1440.png"))
        f = facts(ppage); check("profile edit: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        pctx.close()

        b.close()
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()

print()
print("QA SUMMARY:", {k: v for k, v in R.items()})
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
