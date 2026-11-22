#!/usr/bin/env python3
"""Build -247 rendered QA (the Momentum view text cut):
- Creator at 265 points, phone 390 + desktop 1280: the Momentum
  tab reads number card, ladder, gap line, the one list line,
  Ways to earn rows. The two pasted paragraphs are ABSENT from
  the rendered page: the POINTS_WHY_LONG text ("Points are
  priority. They move you up...") and the "Earned for on-time
  posts..." prose line.
- The blue check explainer sheet (tap the meter check) carries
  the relocated fact as one short line, EN then ES: "Points are
  not money, and they never promise a booking." / "Los puntos
  no son dinero y nunca prometen una reserva."
- Creator at 315 (earned): the ladder status reads "Blue check
  earned" and the view is equally clean.
- No horizontal overflow at 390; no page errors.
Seed: direct-DB (scrypt hashes via hashlib.scrypt, matching
node's scryptSync defaults), referral-tuned Momentum totals
(same recipe as qa-build245). Chromium runs through the local
relay with loopback bypassed, per the standing QA chain.
"""
import base64, hashlib, json, os, struct, subprocess, sys, tempfile, time, urllib.request, zlib

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app-247b")
OUT = os.path.join(ROOT, "docs", "build-247-proof")
os.makedirs(OUT, exist_ok=True)
PORT = 9247
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b247-qa-")
db = os.path.join(tmp, "db.json")
PW = "qa-pass-247"

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
            r = int(162 + (236 - 162) * t); g = 0; bch = int(255 + (140 - 255) * t)
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
        rid = f"q247-ref-{handle}-{i}"
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

creator("q247-band", "band@b247qa.dev", "Band Cat", "bandcat247", 35, 14)    # 245 referrals + 5 local + 10 photo + 5 bio = 265
creator("q247-cross", "cross@b247qa.dev", "Cross Cat", "crosscat247", 35, 19)  # 295 referrals + 20 profile = 315
open(db, "w").write(json.dumps(data))

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b247.dev"
env["ADMIN_PASSWORD"] = "qa-admin-pass-247"
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

        def goto_momentum(page):
            page.evaluate("go('dashboard', 'Momentum')")
            page.wait_for_timeout(2000)

        def tab_text(page):
            return page.evaluate("() => { const el = document.querySelector('#tab-body'); return el ? el.innerText : ''; }")

        def open_sheet(page):
            page.locator(".u226-meter-check").first.click()
            page.wait_for_timeout(700)
            return page.evaluate("""() => {
              const s = document.querySelector('#j226-bluecheck-sheet .sheet');
              return s ? s.innerText : null;
            }""")

        CUT_A = "Points are priority. They move you up"
        CUT_B = "Earned for on-time posts"

        # ---------- band creator (265), phone 390 ----------
        ctx, page, st, errs = open_role("band@b247qa.dev", 390, 844, touch=True)
        check("band creator login 200", st == 200, st)
        goto_momentum(page)
        t = tab_text(page)
        check("view: number card with 265", "Your Momentum" in t and "265" in t, t[:200])
        check("view: gap line (35 points to the blue check, inviting fastest)",
              "35 points to the blue check" in t and "Inviting creators is the fastest way" in t, t[:300])
        check("view: the one list line", "More Momentum, higher on the list businesses see." in t)
        check("view: ladder levels present", all(s in t for s in ["Starter 0", "Regular 100", "Standout 300", "Cornerstone 750"]))
        check("view: Ways to earn rows present", "Ways to earn" in t)
        check("CUT: the long paragraph is NOT on the rendered view", CUT_A not in t and "they ride on your roster card" not in t, t[-400:])
        check("CUT: the Earned-for paragraph is NOT on the rendered view", CUT_B not in t)
        check("view: no horizontal overflow at 390", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "01-momentum-390.png"), full_page=False)
        page.screenshot(path=os.path.join(OUT, "01b-momentum-full-390.png"), full_page=True)
        sheet = open_sheet(page)
        check("sheet opens from the meter check", bool(sheet), sheet)
        check("sheet EN: relocated line (points are not money, never a booking)",
              bool(sheet) and "Points are not money, and they never promise a booking." in sheet, sheet)
        check("sheet EN: -245 facts intact", bool(sheet) and "Standout, earned" in sheet and "18 hours early" in sheet and "never bought" in sheet, sheet)
        page.screenshot(path=os.path.join(OUT, "02-sheet-en-390.png"), full_page=False)
        page.evaluate("closeBlueCheck226()")
        page.wait_for_timeout(300)
        check("band session: no page errors", errs == [], errs)
        ctx.close()

        # ---------- band creator, desktop 1280 ----------
        ctx, page, st, errs = open_role("band@b247qa.dev", 1280, 900)
        goto_momentum(page)
        t = tab_text(page)
        check("desktop view: number, gap line, list line present",
              "265" in t and "35 points to the blue check" in t and "More Momentum, higher on the list businesses see." in t, t[:200])
        check("desktop CUT: neither paragraph renders", CUT_A not in t and CUT_B not in t)
        page.screenshot(path=os.path.join(OUT, "03-momentum-desktop.png"), full_page=False)
        check("desktop session: no page errors", errs == [], errs)
        ctx.close()

        # ---------- band creator, ES ----------
        ctx, page, st, errs = open_role("band@b247qa.dev", 390, 844, touch=True, lang="es")
        goto_momentum(page)
        t = tab_text(page)
        check("ES view: gap line in Spanish", "35 puntos para la insignia azul" in t, t[:300])
        check("ES CUT: neither paragraph renders", CUT_A not in t and CUT_B not in t)
        page.screenshot(path=os.path.join(OUT, "05-momentum-es-390.png"), full_page=False)
        sheet = open_sheet(page)
        check("sheet ES: relocated line (los puntos no son dinero)",
              bool(sheet) and "Los puntos no son dinero y nunca prometen una reserva." in sheet, sheet)
        check("sheet ES: -245 facts intact", bool(sheet) and "300 puntos de Momentum" in sheet and "18 horas antes" in sheet and "nunca se compra" in sheet, sheet)
        page.screenshot(path=os.path.join(OUT, "04-sheet-es-390.png"), full_page=False)
        check("ES session: no page errors", errs == [], errs)
        ctx.close()

        # ---------- cross creator (315, earned), phone 390 ----------
        ctx, page, st, errs = open_role("cross@b247qa.dev", 390, 844, touch=True)
        goto_momentum(page)
        t = tab_text(page)
        check("earned view: status reads Blue check earned", "Blue check earned" in t, t[:300])
        check("earned CUT: neither paragraph renders", CUT_A not in t and CUT_B not in t)
        page.screenshot(path=os.path.join(OUT, "06-momentum-earned-390.png"), full_page=False)
        check("earned session: no page errors", errs == [], errs)
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()

print(f"\nqa-build247: {R['passed']} passed, {R['failed']} failed")
sys.exit(1 if R["failed"] else 0)
