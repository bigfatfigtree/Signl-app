#!/usr/bin/env python3
"""Build -248 rendered QA (desktop parity):
- Business at desktop 1440: Find creators leads with the card
  grid (the Your Lineup panel is NOT in the layout), the filter
  rail sits off-canvas until the Filters button opens it as a
  sheet; the creator profile splits into main column + right
  rail (Open to, audience accounts, the Standout card); the
  Results view runs its stat tiles four across with the two
  charts side by side.
- Creator at desktop 1440: Find offers cards run two across;
  the business profile puts Open offers in the right rail;
  the Wallet's next-move card sits beside the money cards;
  Momentum gains the business-eye rail (own feed card + level
  card) and pairs its earn rows two across.
- Phone 390 regression on every touched surface: single
  column, the Lineup panel still present on Find creators,
  the desktop-only rail cards hidden, no horizontal overflow,
  no page errors.
- ES spot check: the Momentum rail caption reads in Spanish.
Seed: direct-DB (scrypt hashes via hashlib.scrypt, matching
node's scryptSync defaults), referrals-tuned Momentum totals
borrowed from qa-build245 (35 sign-ups / N approvals + 20
profile points). Chromium runs through the local relay with
loopback bypassed, per the standing QA chain.
"""
import base64, hashlib, json, os, struct, subprocess, sys, tempfile, time, urllib.request, zlib

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app-desktop")
OUT = os.path.join(ROOT, "docs", "build-248-proof")
os.makedirs(OUT, exist_ok=True)
PORT = 9248
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b248-qa-")
db = os.path.join(tmp, "db.json")
PW = "qa-pass-248"

def png_gradient(w=800, h=1000, c1=(162, 0, 255), c2=(236, 0, 140)):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        return c
    raw = b""
    for y in range(h):
        raw += b"\x00"
        for x in range(w):
            t = (x + y) / (w + h)
            raw += bytes([int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)])
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

def pw_hash(pw):
    salt = os.urandom(16).hex()
    h = hashlib.scrypt(pw.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
    return salt, h

SALT, HASH = pw_hash(PW)
NOW = "2026-11-15T00:00:00.000Z"
RECENT = "2026-11-19T15:00:00.000Z"
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
        rid = f"q248-ref-{handle}-{i}"
        data[f"user:{rid}"] = {"id": rid, "role": "creator", "status": "approved" if i < approved else "pending",
            "email": f"{rid}@test.io", "name": f"Ref {i}", "market": "Nashville", "city": "Nashville",
            "referredBy": handle, "creator": {"handle": f"ref{handle}{i}"}, "createdAt": NOW, "updatedAt": NOW, "reviewedAt": NOW}
PHOTO = base64.b64encode(png_gradient()).decode()
PHOTO2 = base64.b64encode(png_gradient(800, 1000, (3, 201, 171), (0, 106, 252))).decode()
def photos_for(uid, n=4):
    for i in range(n):
        key = f"photo:{uid}" if i == 0 else f"photo:{uid}:{i}"
        data[key] = {"contentType": "image/png", "dataBase64": PHOTO if i % 2 == 0 else PHOTO2}
def creator(id, email, name, handle, signups, approved, **kw):
    c = {"handle": handle, "followerCount": 10400, "totalAudience": 21500,
         "audienceStack": {"instagram": 10400, "tiktok": 7300, "threads": 3800},
         "platformLocalPct": {"instagram": 82, "tiktok": 79, "threads": 77},
         "localAudiencePct": 82, "categories": ["Food & Drink", "Lifestyle"],
         "hasPhoto": True, "photoCount": 4, "photoUploadedAt": NOW,
         "bio": "I post the places I actually eat, every week, for my Nashville followers.",
         "paidRate": 125, "compOpen": True, "couponOpen": False, "neighborhood": "12 South",
         "profileComplete": True, "tierBand": "Locals"}
    c.update(kw)
    put_user(base_user(id, "creator", email, name, creator=c))
    photos_for(id)
    referrals(handle, signups, approved)

creator("q248-cross", "cross@b248qa.dev", "Priya Nair", "crosscat248", 35, 19)   # 315 pts, blue check
creator("q248-band", "band@b248qa.dev", "Band Cat", "bandcat248", 35, 14, categories=["Music", "Nightlife"], paidRate=150, localAudiencePct=76, neighborhood="East Nashville")  # 265 pts
creator("q248-maya", "maya@b248qa.dev", "Maya Torres", "mayat248", 0, 0, categories=["Beauty", "Lifestyle"], paidRate=95, localAudiencePct=76, neighborhood="East Nashville")
creator("q248-sofia", "sofia@b248qa.dev", "Sofia Reyes", "sofiar248", 0, 0, categories=["Food & Drink"], paidRate=110, localAudiencePct=74, neighborhood="The Gulch")
creator("q248-marcus", "marcus@b248qa.dev", "Marcus Bell", "marcusb248", 0, 0, categories=["Music", "Nightlife"], paidRate=150, localAudiencePct=68, neighborhood="Midtown")
creator("q248-elena", "elena@b248qa.dev", "Elena Brooks", "elenab248", 0, 0, categories=["Fitness", "Wellness"], paidRate=85, localAudiencePct=71, neighborhood="Green Hills")
creator("q248-jordan", "jordan@b248qa.dev", "Jordan Lee", "jordanl248", 0, 0, categories=["Lifestyle", "Family"], paidRate=75, localAudiencePct=64, neighborhood="Berry Hill")

put_user(base_user("q248-biz", "business", "biz@b248qa.dev", "Biz Owner", business={
    "businessName": "QA Cafe 248", "category": "Cafe", "plan": "growth", "planId": "growth",
    "accessState": "active", "about": "Coffee and brunch in East Nashville.",
    "neighborhood": "East Nashville", "hasPhoto": True, "photoCount": 4}))
photos_for("q248-biz")
data["config:markets"] = {"flags": {"Nashville": True}}

BASE_OFFER = {"lane": "open", "creatorId": None, "creatorHandle": None, "covers": 2, "cashRate": None,
              "targetTiers": None, "visitWindow": "", "windowMode": "7days", "spots": 3, "status": "open",
              "createdAt": RECENT, "updatedAt": RECENT, "publishedAt": RECENT}
def offer(id, kind, title, **kw):
    o = dict(BASE_OFFER)
    o.update({"id": id, "kind": kind, "title": title, "businessId": "q248-biz",
              "businessName": "QA Cafe 248", "market": "Nashville", "category": "Coffee & Bakery"})
    o.update(kw)
    data[f"offer:{id}"] = o
offer("q248-off1", "comp", "Comped chef's counter seats, on us", whatComped="Chef's counter for two", includes="Two seats, full tasting", dollarCap=120)
offer("q248-off2", "comp", "Seasonal tasting menu for two", whatComped="Tasting menu for two", includes="Five courses", dollarCap=120)
offer("q248-off3", "paid", "Weekend brunch launch post", cashRate=150, dollarCap=0)
offer("q248-off4", "coupon", "Bakery box, on us with a post", whatComped="Bakery box", includes="One box", dollarCap=75,
      coupon={"type": "store_credit", "amount": 75, "appliesTo": "Anything in the store"})

def booking(id, creator_id, creator_name, title, kind, days_ago, **kw):
    b = {"id": id, "creatorId": creator_id, "businessId": "q248-biz", "businessName": "QA Cafe 248",
         "creatorName": creator_name, "title": title, "kind": kind, "status": "booked",
         "market": "Nashville", "createdAt": RECENT, "redeemedAt": RECENT}
    b.update(kw)
    data[f"booking:{id}"] = b
booking("q248-bk1", "q248-band", "Band Cat", "New menu shoot: paid visit", "paid", 4,
        paidLane={"rate": 150, "creatorNet": 145.5, "businessTotal": 154.5, "platformFee": 9, "escrowState": "released"},
        redemptions={"count": 23, "spend": 612})
booking("q248-bk2", "q248-band", "Band Cat", "Brunch launch: paid visit", "paid", 1,
        paidLane={"rate": 200, "creatorNet": 194, "businessTotal": 206, "platformFee": 12, "escrowState": "held"})
booking("q248-bk3", "q248-band", "Band Cat", "Dinner for two, on us", "comp", 6, dollarCap=120,
        whatComped="Dinner for two: two mains, two drinks", redemptions={"count": 11, "spend": 240})
booking("q248-bk4", "q248-cross", "Priya Nair", "Tasting menu visit", "comp", 3, dollarCap=120,
        whatComped="Tasting menu for two", redemptions={"count": 17, "spend": 388})
data["post:q248-pp1"] = {"id": "q248-pp1", "bookingId": "q248-bk1", "creatorId": "q248-band",
    "url": "https://instagram.com/p/qa248/", "submittedAt": RECENT, "firstAt": RECENT, "onTime": True,
    "views": 6100, "likes": 420, "comments": 38, "shares": 25, "saves": 61}
data["post:q248-pp3"] = {"id": "q248-pp3", "bookingId": "q248-bk3", "creatorId": "q248-band",
    "url": "https://instagram.com/p/qa248b/", "submittedAt": RECENT, "firstAt": RECENT, "onTime": True,
    "views": 4300, "likes": 260, "comments": 19, "shares": 12, "saves": 30}
data["license:q248-lic1"] = {"id": "q248-lic1", "creatorId": "q248-band", "businessId": "q248-biz",
    "businessName": "QA Cafe 248", "postId": "q248-pp1", "fee": 150, "creatorNet": 145.5,
    "status": "granted", "createdAt": RECENT, "windowEndsAt": "2027-02-17T00:00:00.000Z"}
open(db, "w").write(json.dumps(data))

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b248.dev"
env["ADMIN_PASSWORD"] = "qa-admin-pass-248"
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

        def imgs_ok(page):
            return page.evaluate("""(async () => {
              const imgs = [...document.images].filter((i) => i.src);
              await Promise.all(imgs.map((i) => i.complete ? null
                : Promise.race([i.decode().catch(() => {}), new Promise((r) => setTimeout(r, 4000))])));
              const bad = imgs.filter((i) => !(i.complete && i.naturalWidth > 0));
              if (!bad.length) return true;
              const oks = await Promise.all(bad.map((i) => fetch(i.src)
                .then((r) => r.ok && (r.headers.get('content-type') || '').indexOf('image') === 0)
                .catch(() => false)));
              return oks.every(Boolean);
            })()""")

        def geom(page, expr):
            return page.evaluate(expr)

        # ---------- business, desktop 1440: Find creators ----------
        ctx, page, st, errs = open_role("biz@b248qa.dev", 1440, 1000)
        check("business login 200", st == 200, st)
        page.evaluate("loadDiscover()")
        page.wait_for_timeout(2600)
        lineup_display = geom(page, "getComputedStyle(document.getElementById('lineup-slot')).display")
        check("desktop feed: Lineup panel NOT in the layout", lineup_display == "none", lineup_display)
        col = geom(page, """() => {
          const rail = document.getElementById('disc-rail');
          const rr = rail.getBoundingClientRect();
          const firstCard = document.querySelector('.shelf-grid [data-u226="creator-card"]');
          const cr = firstCard ? firstCard.getBoundingClientRect() : null;
          const labels = [...rail.querySelectorAll('.df-label')].map((l) => (l.textContent || '').trim());
          const search = document.getElementById('f-q-rail');
          const srow = document.querySelector('.shop-layout .shop-searchrow');
          const clear = rail.querySelector('.rail-clear248');
          return { railW: Math.round(rr.width), railVisible: rr.width > 200 && rr.left >= 0,
                   leftOfGrid: !!cr && rr.right <= cr.left + 2,
                   labels: labels.slice(0, 6), cats: rail.querySelectorAll('[data-dcat-box]').length,
                   searchVisible: !!search && search.offsetParent !== null,
                   searchAboveSort: !!search && !!document.getElementById('f-sort')
                     && search.getBoundingClientRect().top < document.getElementById('f-sort').getBoundingClientRect().top,
                   searchrowHidden: !!srow && getComputedStyle(srow).display === 'none',
                   clearVisible: !!clear && clear.offsetParent !== null };
        }""")
        check("desktop feed: filter column present, left of the grid", col.get("railVisible") and col.get("leftOfGrid"), col)
        check("desktop feed: search at the top of the column", col.get("searchVisible") and col.get("searchAboveSort"), col)
        check("desktop feed: locked order Sort, Must-haves, Category",
              col.get("labels", [])[:4] == ["Search", "Where & sort", "Must-haves", "Category"], col.get("labels"))
        check("desktop feed: all twelve categories in the column", col.get("cats") == 12, col.get("cats"))
        check("desktop feed: Clear all in the column", col.get("clearVisible"), col)
        check("desktop feed: main search row stood down", col.get("searchrowHidden"), col)
        grid = geom(page, """() => {
          const cards = [...document.querySelectorAll('.shelf-grid [data-u226="creator-card"]')];
          if (cards.length < 3) return { n: cards.length };
          const tops = cards.slice(0, 3).map((c) => Math.round(c.getBoundingClientRect().top));
          return { n: cards.length, row1: tops[0] === tops[1], second: tops[2] > tops[0] };
        }""")
        check("desktop feed: creator cards 2 across beside the column", grid.get("row1") and grid.get("second"), grid)
        page.fill("#f-q-rail", "maya")
        page.wait_for_timeout(1600)
        narrowed = geom(page, """() => {
          const cards = [...document.querySelectorAll('.shelf-grid [data-u226="creator-card"]')];
          return { n: cards.length, text: cards.map((c) => c.innerText).join(' ').slice(0, 120) };
        }""")
        check("desktop feed: column search filters the grid", narrowed.get("n") == 1 and "Maya" in (narrowed.get("text") or ""), narrowed)
        page.fill("#f-q-rail", "")
        page.wait_for_timeout(1600)
        check("desktop feed: every image loaded", imgs_ok(page))
        check("desktop feed: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "01-feed-desktop.png"))
        page.set_viewport_size({"width": 1150, "height": 950})
        page.wait_for_timeout(900)
        narrow = geom(page, """() => {
          const cards = [...document.querySelectorAll('.shelf-grid [data-u226="creator-card"]')];
          if (cards.length < 2) return { n: cards.length };
          const t0 = Math.round(cards[0].getBoundingClientRect().top), t1 = Math.round(cards[1].getBoundingClientRect().top);
          return { n: cards.length, stacked: t1 > t0 };
        }""")
        check("narrow desktop feed: cards drop to one across, never squeeze", narrow.get("stacked"), narrow)
        check("narrow desktop feed: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.set_viewport_size({"width": 1440, "height": 1000})
        page.wait_for_timeout(600)

        # ---------- business, desktop: creator profile ----------
        page.evaluate("openCreatorProfile('q248-cross')")
        page.wait_for_timeout(1500)
        prof = geom(page, """() => {
          const hero = document.querySelector('.pdp248 .u226-hero');
          const open = document.querySelector('.pdp248 [data-j226="open-to"]');
          const stand = document.querySelector('.pdp248 .pdp248-standcard');
          const photos = [...document.querySelectorAll('.pdp248 .u226-photoimg')];
          if (!hero || !open) return { missing: true };
          const hr = hero.getBoundingClientRect(), orr = open.getBoundingClientRect();
          const ptop = photos.length ? Math.round(photos[0].getBoundingClientRect().top) : -1;
          const prow = photos.length > 3 ? Math.round(photos[3].getBoundingClientRect().top) : -1;
          return { railRight: orr.left > hr.left + hr.width * 0.55, standText: stand ? stand.innerText : "",
                   photosRow: photos.length >= 4 && ptop === prow, standVisible: !!stand && stand.offsetParent !== null };
        }""")
        check("desktop profile: Open to rides the right rail", prof.get("railRight"), prof)
        check("desktop profile: Standout card shows for the 300+ creator", prof.get("standVisible") and "Standout" in (prof.get("standText") or ""), prof)
        check("desktop profile: Photos run four across", prof.get("photosRow"), prof)
        check("desktop profile: every image loaded", imgs_ok(page))
        check("desktop profile: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "03-creator-profile-desktop.png"), full_page=True)

        # ---------- business, desktop: Results ----------
        page.evaluate("go('dashboard','Analytics')")
        page.wait_for_timeout(3200)
        res = geom(page, """() => {
          const tiles = [...document.querySelectorAll('.j226-tiles .j226-tile')];
          const charts = document.querySelector('.charts248');
          const cc = charts ? [...charts.querySelectorAll('.chart-card')] : [];
          const tileTops = tiles.slice(0, 4).map((t) => Math.round(t.getBoundingClientRect().top));
          const tileText = tiles.map((t) => (t.innerText || '').trim()).join(' | ');
          let sideBySide = cc.length < 2 ? null : Math.round(cc[0].getBoundingClientRect().top) === Math.round(cc[1].getBoundingClientRect().top);
          return { tiles: tiles.length, fourAcross: tiles.length >= 4 && tileTops.every((t) => t === tileTops[0]),
                   tileText, charts: cc.length, sideBySide };
        }""")
        check("desktop results: stat tiles render with numbers", res["tiles"] >= 4 and any(ch.isdigit() for ch in res["tileText"]), res)
        check("desktop results: stat tiles four across", res.get("fourAcross"), res)
        if res["charts"] >= 2:
            check("desktop results: charts side by side", res.get("sideBySide"), res)
        else:
            check("desktop results: charts wrapper present", geom(page, "!!document.querySelector('.charts248')"))
        check("desktop results: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "06-results-desktop.png"), full_page=True)
        check("business desktop: no page errors", not errs, errs[:2])
        ctx.close()

        # ---------- business, phone 390 regression: feed + profile ----------
        ctx, page, st, errs = open_role("biz@b248qa.dev", 390, 844, touch=True)
        page.evaluate("loadDiscover()")
        page.wait_for_timeout(2600)
        lineup390 = geom(page, """() => {
          const s = document.getElementById('lineup-slot');
          return s ? getComputedStyle(s).display : 'missing';
        }""")
        check("phone feed: Lineup panel still present at 390", lineup390 != "none", lineup390)
        phone_col = geom(page, """() => {
          const railSearch = document.querySelector('#disc-rail .rail-search248');
          const rail = document.getElementById('disc-rail');
          const q = document.getElementById('f-q');
          const btn = document.getElementById('disc-rail-btn');
          return { railSearchHidden: !!railSearch && getComputedStyle(railSearch).display === 'none',
                   railClosed: getComputedStyle(rail).visibility === 'hidden',
                   searchVisible: !!q && q.offsetParent !== null,
                   filtersBtnVisible: !!btn && btn.offsetParent !== null };
        }""")
        check("phone feed: search bar + Filter button unchanged", phone_col.get("searchVisible") and phone_col.get("filtersBtnVisible"), phone_col)
        check("phone feed: no desktop column search, rail stays the closed sheet", phone_col.get("railSearchHidden") and phone_col.get("railClosed"), phone_col)
        check("phone feed: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.evaluate("openCreatorProfile('q248-cross')")
        page.wait_for_timeout(1500)
        stand390 = geom(page, "(() => { const s = document.querySelector('.pdp248 .pdp248-standcard'); return s ? getComputedStyle(s.closest('.pdp248-railslot')).display : 'missing'; })()")
        check("phone profile: desktop Standout card hidden at 390", stand390 == "none", stand390)
        check("phone profile: no horizontal overflow", overflow(page) <= 0, overflow(page))
        check("business phone: no page errors", not errs, errs[:2])
        ctx.close()

        # ---------- creator, desktop 1440: Find offers ----------
        ctx, page, st, errs = open_role("band@b248qa.dev", 1440, 1000)
        check("creator login 200", st == 200, st)
        page.evaluate("go('dashboard','Find Offers')")
        page.wait_for_timeout(3000)
        fo = geom(page, """() => {
          const cards = [...document.querySelectorAll('#cr-findoffers .mirror-grid [data-u226="offer-card"]')];
          if (cards.length < 3) return { n: cards.length };
          const tops = cards.slice(0, 3).map((c) => Math.round(c.getBoundingClientRect().top));
          return { n: cards.length, twoAcross: tops[0] === tops[1] && tops[2] > tops[0] };
        }""")
        check("desktop offers: cards render", fo.get("n", 0) >= 3, fo)
        check("desktop offers: two across", fo.get("twoAcross"), fo)
        focol = geom(page, """() => {
          const rail = document.getElementById('fo-rail');
          const rr = rail.getBoundingClientRect();
          const firstCard = document.querySelector('#cr-findoffers .mirror-grid [data-u226="offer-card"]');
          const cr = firstCard ? firstCard.getBoundingClientRect() : null;
          const labels = [...rail.querySelectorAll('.df-label')].map((l) => (l.textContent || '').trim());
          const search = document.getElementById('fo-q-rail');
          const srow = document.querySelector('#cr-findoffers .shop-searchrow');
          const clear = rail.querySelector('.rail-clear248');
          const sortSel = rail.querySelector('.fo-selfilter select');
          return { railVisible: rr.width > 200 && rr.left >= 0, leftOfGrid: !!cr && rr.right <= cr.left + 2,
                   labels: labels.slice(0, 4), searchVisible: !!search && search.offsetParent !== null,
                   searchAboveSort: !!search && !!sortSel && search.getBoundingClientRect().top < sortSel.getBoundingClientRect().top,
                   searchrowHidden: !!srow && getComputedStyle(srow).display === 'none',
                   clearVisible: !!clear && clear.offsetParent !== null };
        }""")
        check("desktop offers: filter column present, left of the grid", focol.get("railVisible") and focol.get("leftOfGrid"), focol)
        check("desktop offers: search at the top of the column", focol.get("searchVisible") and focol.get("searchAboveSort"), focol)
        check("desktop offers: locked order Search, Sort, The offer, Category",
              focol.get("labels", [])[:4] == ["Search", "Sort", "The offer", "Category"], focol.get("labels"))
        check("desktop offers: Clear all in the column", focol.get("clearVisible"), focol)
        check("desktop offers: main search row stood down", focol.get("searchrowHidden"), focol)
        page.fill("#fo-q-rail", "brunch")
        page.wait_for_timeout(1600)
        fon = geom(page, """() => {
          const cards = [...document.querySelectorAll('#cr-findoffers .mirror-grid [data-u226="offer-card"]')];
          return { n: cards.length, focus: document.activeElement ? document.activeElement.id : '',
                   text: cards.map((c) => c.innerText).join(' ').slice(0, 120) };
        }""")
        check("desktop offers: column search filters the grid", fon.get("n") == 1 and "brunch" in (fon.get("text") or "").lower(), fon)
        check("desktop offers: focus returns to the column search", fon.get("focus") == "fo-q-rail", fon)
        page.fill("#fo-q-rail", "")
        page.wait_for_timeout(1600)
        check("desktop offers: every image loaded", imgs_ok(page))
        check("desktop offers: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "02-find-offers-desktop.png"))

        # ---------- creator, desktop: business profile ----------
        page.evaluate("openBusiness226('q248-biz')")
        page.wait_for_timeout(2200)
        bp = geom(page, """() => {
          const hero = document.querySelector('.bizp248 .u226-hero');
          const offers = document.getElementById('u226-biz-offers');
          if (!hero || !offers) return { missing: true };
          const hr = hero.getBoundingClientRect(), orr = offers.getBoundingClientRect();
          return { rail: orr.left > hr.left + hr.width * 0.55, offersText: (offers.innerText || '').slice(0, 60) };
        }""")
        check("desktop business profile: Open offers rides the right rail", bp.get("rail"), bp)
        check("desktop business profile: offers listed", "Open offers" in (bp.get("offersText") or ""), bp)
        check("desktop business profile: every image loaded", imgs_ok(page))
        check("desktop business profile: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "04-business-profile-desktop.png"), full_page=True)

        # ---------- creator, desktop: Wallet ----------
        page.evaluate("go('dashboard','Earnings')")
        page.wait_for_timeout(3000)
        wal = geom(page, """() => {
          const grid = document.querySelector('.wallet248-top > .kpi-grid');
          const next = document.querySelector('.wallet248-top > .money-next');
          if (!grid || !next) return { missing: true, grid: !!grid, next: !!next };
          const gr = grid.getBoundingClientRect(), nr = next.getBoundingClientRect();
          return { beside: nr.left > gr.left + gr.width * 0.6 && Math.abs(nr.top - gr.top) < 60,
                   nums: (grid.innerText || '').includes('$'), nextText: (next.innerText || '').slice(0, 40) };
        }""")
        check("desktop wallet: next-move card beside the money cards", wal.get("beside"), wal)
        check("desktop wallet: money cards carry amounts", wal.get("nums"), wal)
        check("desktop wallet: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "05-wallet-desktop.png"), full_page=True)

        # ---------- creator, desktop: Momentum ----------
        page.evaluate("go('dashboard','Momentum')")
        page.wait_for_timeout(2600)
        mom = geom(page, """() => {
          const rail = document.querySelector('.mom248-rail');
          if (!rail || rail.offsetParent === null) return { rail: false };
          const rows = [...document.querySelectorAll('.mom248-main .panel.mt > .earn-row')];
          let paired = false;
          if (rows.length >= 2) {
            const t0 = Math.round(rows[0].getBoundingClientRect().top);
            paired = rows.some((r, i) => i > 0 && Math.round(r.getBoundingClientRect().top) === t0);
          }
          return { rail: true, text: rail.innerText || '', paired,
                   cardInRail: !!rail.querySelector('[data-u226="creator-card"]') };
        }""")
        check("desktop momentum: business-eye rail visible", mom.get("rail"), mom)
        check("desktop momentum: rail carries the creator's own feed card", mom.get("cardInRail"), mom)
        mom_pts = geom(page, "(() => (state.user.momentum || {}).points || 0)()")
        mom_level = "Cornerstone" if mom_pts >= 750 else "Standout" if mom_pts >= 300 else "Regular" if mom_pts >= 100 else "Starter"
        check(f"desktop momentum: rail names the level ({mom_level} at {mom_pts})", mom_level in (mom.get("text") or ""), (mom.get("text") or "")[:120])
        check("desktop momentum: earn rows pair two across", mom.get("paired"), mom)
        check("desktop momentum: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.screenshot(path=os.path.join(OUT, "07-momentum-desktop.png"), full_page=True)
        check("creator desktop: no page errors", not errs, errs[:2])
        ctx.close()

        # ---------- creator, phone 390 regression: offers + wallet + momentum ----------
        ctx, page, st, errs = open_role("band@b248qa.dev", 390, 844, touch=True)
        page.evaluate("go('dashboard','Find Offers')")
        page.wait_for_timeout(3000)
        phone_fo = geom(page, """() => {
          const railSearch = document.querySelector('#fo-rail .rail-search248');
          const q = document.getElementById('fo-q');
          const btn = document.getElementById('fo-rail-btn');
          return { railSearchHidden: !!railSearch && getComputedStyle(railSearch).display === 'none',
                   searchVisible: !!q && q.offsetParent !== null,
                   filtersBtnVisible: !!btn && btn.offsetParent !== null };
        }""")
        check("phone offers: search bar + Filter button unchanged, no column search",
              phone_fo.get("searchVisible") and phone_fo.get("filtersBtnVisible") and phone_fo.get("railSearchHidden"), phone_fo)
        check("phone offers: no horizontal overflow", overflow(page) <= 0, overflow(page))
        page.evaluate("go('dashboard','Earnings')")
        page.wait_for_timeout(3000)
        wal390 = geom(page, """() => {
          const grid = document.querySelector('.wallet248-top > .kpi-grid');
          const next = document.querySelector('.wallet248-top > .money-next');
          if (!grid || !next) return { missing: true };
          return { stacked: next.getBoundingClientRect().top > grid.getBoundingClientRect().top + 40 };
        }""")
        check("phone wallet: next-move stacks below the money cards", wal390.get("stacked"), wal390)
        page.evaluate("go('dashboard','Momentum')")
        page.wait_for_timeout(2600)
        rail390 = geom(page, "(() => { const r = document.querySelector('.mom248-rail'); return r ? getComputedStyle(r).display : 'missing'; })()")
        check("phone momentum: desktop rail hidden at 390", rail390 == "none", rail390)
        check("phone momentum: no horizontal overflow", overflow(page) <= 0, overflow(page))
        check("creator phone: no page errors", not errs, errs[:2])
        ctx.close()

        # ---------- creator, desktop ES: Momentum rail caption ----------
        ctx, page, st, errs = open_role("band@b248qa.dev", 1440, 1000, lang="es")
        page.evaluate("go('dashboard','Momentum')")
        page.wait_for_timeout(2600)
        rail_es = geom(page, "(() => { const r = document.querySelector('.mom248-rail'); return r ? r.innerText : ''; })()")
        check("ES momentum rail: caption in Spanish", "insignia azul" in rail_es, rail_es[:160])
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()
print(f"\nqa-build248: {R['passed']} passed, {R['failed']} failed")
sys.exit(1 if R["failed"] else 0)
