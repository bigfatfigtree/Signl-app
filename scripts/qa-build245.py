#!/usr/bin/env python3
"""Build -245 rendered QA (the Momentum blue check):
- Business at phone 390 + desktop 1280: the Find creators feed
  card for a 300-point creator carries the blue check beside
  the name; a 250-point creator's card does not. The profile
  hero carries it too. Tapping it opens the explainer sheet;
  the sheet text is asserted in EN, then again in ES
  (?lang=es arrival).
- Creator at 250 (band): the Momentum ladder renders with all
  four level markers, the fill at 250/750, the gap line naming
  50 points and inviting as the fastest way.
- Creator at 300 (crossed): the ladder shows the check as
  earned and the fill at 300/750, still running to Cornerstone.
- No horizontal overflow at 390 on any touched surface; no
  page errors.
Seed: direct-DB (scrypt hashes via hashlib.scrypt, matching
node's scryptSync defaults), referrals-tuned Momentum totals
(35 sign-ups / N approvals + 5 profile points = exact totals).
Chromium runs through the local relay with loopback bypassed,
per the standing QA chain.
"""
import base64, hashlib, json, os, struct, subprocess, sys, tempfile, time, urllib.request, zlib

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app-245")
OUT = os.path.join(ROOT, "docs", "build-245-proof")
os.makedirs(OUT, exist_ok=True)
PORT = 9245
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b245-qa-")
db = os.path.join(tmp, "db.json")
PW = "qa-pass-245"

def png_gradient(w=800, h=1000):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        return c
    raw = b""
    for y in range(h):
        raw += b"\x00"
        for x in range(w):
            t = (x + y) / (w + h)
            r = int(162 + (236 - 162) * t); g = int(0 + (0 - 0) * t); bch = int(255 + (140 - 255) * t)
            raw += bytes([r, g, bch])
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

def pw_hash(pw):
    salt = os.urandom(16).hex()
    h = hashlib.scrypt(pw.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
    return salt, h

SALT, HASH = pw_hash(PW)
NOW = "2026-11-15T00:00:00.000Z"
data = {}
def put_user(u):
    data[f"user:{u['id']}"] = u
    data[f"email:{u['email']}"] = {"userId": u["id"]}
def base_user(id, role, email, name, **kw):
    u = {"id": id, "role": role, "email": email, "name": name, "passwordSalt": SALT,
         "passwordHash": HASH, "status": "approved", "market": "Nashville", "city": "Nashville",
         "createdAt": NOW, "updatedAt": NOW, "reviewedAt": NOW}
    u.update(kw)
    return u
def referrals(handle, signups, approved):
    for i in range(signups):
        rid = f"q245-ref-{handle}-{i}"
        data[f"user:{rid}"] = {"id": rid, "role": "creator", "status": "approved" if i < approved else "pending",
            "email": f"{rid}@test.io", "name": f"Ref {i}", "market": "Nashville", "city": "Nashville",
            "referredBy": handle, "creator": {"handle": f"ref{handle}{i}"}, "createdAt": NOW, "updatedAt": NOW, "reviewedAt": NOW}
PHOTO = base64.b64encode(png_gradient()).decode()
def creator(id, email, name, handle, signups, approved):
    put_user(base_user(id, "creator", email, name, creator={
        "handle": handle, "followerCount": 600, "localAudiencePct": 80, "categories": ["Food"],
        "hasPhoto": True, "photoUploadedAt": NOW, "bio": "Nashville food and coffee, posted weekly for local spots.",
        "paidRate": 125}))
    data[f"photo:{id}"] = {"contentType": "image/png", "dataBase64": PHOTO}
    referrals(handle, signups, approved)

creator("q245-cross", "cross@b245qa.dev", "Cross Cat", "crosscat245", 35, 19)   # 295 referrals + 5 local + 10 photo + 5 bio = 315
creator("q245-band", "band@b245qa.dev", "Band Cat", "bandcat245", 35, 14)       # 245 referrals + 5 local + 10 photo + 5 bio = 265
put_user(base_user("q245-biz", "business", "biz@b245qa.dev", "Biz Owner", business={
    "businessName": "QA Cafe 245", "category": "Cafe", "plan": "growth", "planId": "growth",
    "accessState": "active", "about": "Coffee and brunch in East Nashville."}))
open(db, "w").write(json.dumps(data))

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b245.dev"
env["ADMIN_PASSWORD"] = "qa-admin-pass-245"
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "FIREBASE_SERVICE_ACCOUNT_JSON"]:
    env.pop(k, None)
_srv_log = open(os.path.join(OUT, "server.log"), "w")
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=_srv_log, stderr=_srv_log)
R = {"passed": 0, "failed": 0}
def check(name, cond, extra=""):
    if cond:
        R["passed"] += 1; print(f"  ok {name}")
    else:
        R["failed"] += 1; print(f"FAIL {name} :: {str(extra)[:240]}")
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def open_role(email, width, height, touch=False, lang=""):
            opts = {"viewport": {"width": width, "height": height}, "ignore_https_errors": True}
            if touch:
                opts.update({"has_touch": True, "is_mobile": True, "device_scale_factor": 3})
            ctx = b.new_context(**opts)
            page = ctx.new_page()
            page.on("dialog", lambda d: d.accept())
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)[:140]))
            st = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": PW}).status
            page.goto(BASE + "/?lang=es" if lang == "es" else BASE + "/", wait_until="networkidle")
            page.wait_for_timeout(2400)
            return ctx, page, st, errs

        def overflow(page):
            return page.evaluate("Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth")

        def goto_discover(page):
            page.evaluate("loadDiscover()")
            page.wait_for_timeout(2200)

        def card_check_count(page, name):
            return page.evaluate("""(name) => {
              const cards = [...document.querySelectorAll('[data-u226="creator-card"]')];
              const card = cards.find((c) => (c.innerText || '').includes(name));
              if (!card) return -1;
              return card.querySelectorAll('[data-u226="blue-check"]').length;
            }""", name)

        # ---------- business, phone 390 ----------
        ctx, page, st, errs = open_role("biz@b245qa.dev", 390, 844, touch=True)
        check("business login 200", st == 200, st)
        goto_discover(page)
        check("feed: 300-point creator card HAS the blue check", card_check_count(page, "Cross Cat") == 1, card_check_count(page, "Cross Cat"))
        check("feed: 250-point creator card has NO blue check", card_check_count(page, "Band Cat") == 0, card_check_count(page, "Band Cat"))
        check("feed: no horizontal overflow at 390", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "01-feed-390.png"), full_page=False)
        # Reviewer additions: the Lineup row and the Saved card
        # carry the check too, and every image on the page must
        # actually load (workspace QA image rule).
        lineup = page.evaluate("""() => {
          const lu = document.querySelector('#lineup-card');
          if (!lu) return null;
          const rows = [...lu.querySelectorAll('div')].filter((d) => (d.innerText || '').includes('Cross Cat'));
          const row = rows.length ? rows[rows.length - 1] : null;
          return row ? row.querySelectorAll('[data-u226="blue-check"]').length : -1;
        }""")
        check("lineup: the 300-point creator's row HAS the blue check", lineup == 1, lineup)
        # Geometry note (measured, Build -245): the Lineup
        # middle column is ~81px wide, so a long name fills
        # line 1 and the check takes line 2, badge-style, with
        # the handle below it (button bottom == handle top, no
        # overlap). Long handles overflow that column in the
        # pre-existing design, with or without the check.
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(900)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)
        imgs = page.evaluate("""() => [...document.images].filter((i) => i.src).map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.src.slice(-40) }))""")
        check("feed: every image actually loaded", all(i["ok"] for i in imgs) and len(imgs) > 0, [i for i in imgs if not i["ok"]])
        page.evaluate("""() => {
          const cards = [...document.querySelectorAll('[data-u226="creator-card"]')];
          const card = cards.find((c) => (c.innerText || '').includes('Cross Cat'));
          const fav = card && card.querySelector('[data-u226="fav-btn"]');
          if (fav) fav.click();
        }""")
        page.wait_for_timeout(1200)
        page.evaluate("openSaved226()")
        page.wait_for_timeout(2000)
        saved = page.evaluate("""() => {
          const body = document.querySelector('#u226-saved-body');
          if (!body) return null;
          const cards = [...body.querySelectorAll('[data-u226="creator-card"]')];
          const card = cards.find((c) => (c.innerText || '').includes('Cross Cat'));
          return card ? card.querySelectorAll('[data-u226="blue-check"]').length : -1;
        }""")
        check("saved: the saved 300-point card HAS the blue check", saved == 1, saved)
        page.evaluate("loadDiscover()")
        page.wait_for_timeout(1800)
        # open the crossing creator's profile from the card
        page.evaluate("""() => {
          const cards = [...document.querySelectorAll('[data-u226="creator-card"]')];
          const card = cards.find((c) => (c.innerText || '').includes('Cross Cat'));
          const btn = [...card.querySelectorAll('button')].find((x) => /See profile/.test(x.innerText || ''));
          if (btn) btn.click();
        }""")
        page.wait_for_timeout(1600)
        hero = page.evaluate("""() => {
          const h = document.querySelector('.u226-heroname');
          return h ? { text: h.innerText.trim(), checks: h.querySelectorAll('[data-u226="blue-check"]').length } : null;
        }""")
        check("profile hero carries the check beside the first name", bool(hero) and hero["checks"] == 1, hero)
        page.screenshot(path=os.path.join(OUT, "02-profile-hero-390.png"), full_page=False)
        page.locator('[data-u226="blue-check"]').first.click()
        page.wait_for_timeout(700)
        sheet = page.evaluate("""() => {
          const s = document.querySelector('#j226-bluecheck-sheet .sheet');
          return s ? s.innerText : null;
        }""")
        check("explainer sheet opens on tap", bool(sheet), sheet)
        check("sheet EN: Standout at 300, earn ways, 18 hours early, never bought",
              bool(sheet) and "Standout, earned" in sheet and "300 Momentum points" in sheet
              and "delivering posts on time, reviewing businesses, and inviting" in sheet
              and "18 hours early" in sheet and "never bought" in sheet, sheet)
        page.screenshot(path=os.path.join(OUT, "03-sheet-en-390.png"), full_page=False)
        page.evaluate("closeBlueCheck226()")
        page.wait_for_timeout(300)
        check("sheet closes", page.evaluate("!!document.querySelector('#j226-bluecheck-sheet')") is False)
        check("business session: no page errors", errs == [], errs)
        ctx.close()

        # ---------- business, desktop 1280 ----------
        ctx, page, st, errs = open_role("biz@b245qa.dev", 1280, 900)
        goto_discover(page)
        check("desktop feed: check present on the 300 card only",
              card_check_count(page, "Cross Cat") == 1 and card_check_count(page, "Band Cat") == 0,
              (card_check_count(page, "Cross Cat"), card_check_count(page, "Band Cat")))
        page.screenshot(path=os.path.join(OUT, "07-feed-desktop.png"), full_page=False)
        ctx.close()

        # ---------- business, ES sheet ----------
        ctx, page, st, errs = open_role("biz@b245qa.dev", 390, 844, touch=True, lang="es")
        goto_discover(page)
        check("ES feed: check still renders on the 300 card", card_check_count(page, "Cross Cat") == 1, card_check_count(page, "Cross Cat"))
        page.locator('[data-u226="blue-check"]').first.click()
        page.wait_for_timeout(700)
        sheet = page.evaluate("""() => {
          const s = document.querySelector('#j226-bluecheck-sheet .sheet');
          return s ? s.innerText : null;
        }""")
        check("sheet ES: insignia azul, 300 puntos, 18 horas antes, nunca se compra",
              bool(sheet) and "insignia azul" in sheet.lower() and "300 puntos de Momentum" in sheet
              and "18 horas antes" in sheet and "nunca se compra" in sheet, sheet)
        page.screenshot(path=os.path.join(OUT, "04-sheet-es-390.png"), full_page=False)
        ctx.close()

        # ---------- creator at 250: the ladder ----------
        ctx, page, st, errs = open_role("band@b245qa.dev", 390, 844, touch=True)
        check("band creator login 200", st == 200, st)
        page.evaluate("go('dashboard', 'Momentum')")
        page.wait_for_timeout(1800)
        meter = page.evaluate("""() => {
          const m = document.querySelector('[data-u226="momentum-meter"]');
          if (!m) return null;
          const fill = m.querySelector('.u226-meter-fill');
          const chk = m.querySelector('.u226-meter-check');
          return { text: m.innerText, fillW: fill ? fill.style.width : null,
                   checkOn: chk ? chk.classList.contains('on') : null };
        }""")
        check("ladder renders on the Momentum view", bool(meter), meter)
        if meter:
            check("ladder carries all four levels", all(s in meter["text"] for s in ["Starter 0", "Regular 100", "Standout 300", "Cornerstone 750"]), meter["text"])
            check("fill sits at 265/750 (35.3%)", meter["fillW"] == "35.3%", meter["fillW"])
            check("check marker not yet earned", meter["checkOn"] is False, meter["checkOn"])
            check("gap line: 35 points to the blue check, inviting is fastest",
                  "35 points to the blue check" in meter["text"] and "Inviting creators is the fastest way" in meter["text"], meter["text"])
            check("the one line about the list businesses see", "More Momentum, higher on the list businesses see." in meter["text"], meter["text"])
        check("momentum view: no horizontal overflow at 390", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "05-meter-band-390.png"), full_page=False)
        # The Bench card (creator to creator) carries the check
        # beside the name too, in a line that cannot wrap onto it.
        page.evaluate("go('dashboard', 'Bench')")
        page.wait_for_timeout(2600)
        # The Bench is pre-launch by design (it opens when the
        # market launches), so the card list never renders yet;
        # the gate is the real /me/bench payload, whose
        # introduction creator object is built by benchCardFor.
        bench = page.evaluate("""async () => {
          const d = await api('GET', '/me/bench');
          const intro = d && d.introduction && d.introduction.creator;
          return intro ? { name: intro.name, blueCheck: intro.blueCheck } : null;
        }""")
        check("bench payload: the 300-point introduction creator carries blueCheck true",
              bool(bench) and bench["name"] == "Cross Cat" and bench["blueCheck"] is True, bench)
        page.screenshot(path=os.path.join(OUT, "08-bench-390.png"), full_page=False)
        check("band creator session: no page errors", errs == [], errs)
        ctx.close()

        # ---------- creator at 300: earned ----------
        ctx, page, st, errs = open_role("cross@b245qa.dev", 390, 844, touch=True)
        page.evaluate("go('dashboard', 'Momentum')")
        page.wait_for_timeout(1800)
        meter = page.evaluate("""() => {
          const m = document.querySelector('[data-u226="momentum-meter"]');
          if (!m) return null;
          const fill = m.querySelector('.u226-meter-fill');
          const chk = m.querySelector('.u226-meter-check');
          return { text: m.innerText, fillW: fill ? fill.style.width : null,
                   checkOn: chk ? chk.classList.contains('on') : null };
        }""")
        check("earned ladder renders", bool(meter), meter)
        if meter:
            check("fill sits at 315/750 (42%) and keeps going toward Cornerstone", meter["fillW"] == "42%", meter["fillW"])
            check("check marker shows earned", meter["checkOn"] is True, meter["checkOn"])
            check("status reads Blue check earned", "Blue check earned" in meter["text"], meter["text"])
        page.screenshot(path=os.path.join(OUT, "06-meter-cross-390.png"), full_page=False)
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()

print(f"\nqa-build245: {R['passed']} passed, {R['failed']} failed")
sys.exit(1 if R["failed"] else 0)
