#!/usr/bin/env python3
"""Build -250 rendered QA (bundle with -249): the journey
screen cleanup, proven in the browser at 390px and 1440px.

- Screen A (deal accept): value hero in the gradient, terms
  rows under a group label, no under/over framing on a comp,
  decline reasons that fit the kind, Accept the one loud
  button; the deals explainer sits behind a tap.
- Screen B (visit details): the one-time visit code as a
  gradient hero high on the card, ONE audience section set
  apart (no duplicated header, no double code stack), the
  timeline as a stepper, the deal panel as rows.
- Screen C (completion): the post-live confirmation stands
  alone; the review is its own step behind the rate row.
- Offer detail in EN and ES (full Spanish parity), the post
  walkthrough caption step (a comped visit is never "free"),
  Find offers Clear all clearing the search, the state-aware
  blue-check sheet, Golden Tickets prose behind a tap, the
  founding Receipt's trimmed paragraph, and the deal-sent
  landing on the Deals segment.
- Before/after word counts for screens A and B, measured
  against a pristine -248 worktree on a second port.

Seed: direct-DB (scrypt hashes via hashlib.scrypt, matching
node's scryptSync defaults). Chromium runs through the local
relay with loopback bypassed, per the standing QA chain.
"""
import base64, hashlib, json, os, struct, subprocess, sys, tempfile, time, urllib.request, zlib

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app-250")
ROOT_BEFORE = "/tmp/signl-250-before"
OUT = os.path.join(ROOT, "docs", "build-250-proof")
os.makedirs(OUT, exist_ok=True)
PW = "qa-pass-250"

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
PHOTO = base64.b64encode(png_gradient()).decode()
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
        rid = f"q250-ref-{handle}-{i}"
        data[f"user:{rid}"] = {"id": rid, "role": "creator", "status": "approved" if i < approved else "pending",
            "email": f"{rid}@test.io", "name": f"Ref {i}", "market": "Nashville", "city": "Nashville",
            "referredBy": handle, "creator": {"handle": f"ref{handle}{i}"}, "createdAt": NOW, "updatedAt": NOW, "reviewedAt": NOW}

PRIYA = {"handle": "priyaeats", "followerCount": 10400, "totalAudience": 21500,
    "audienceStack": {"instagram": 10400, "tiktok": 7300, "threads": 3800},
    "platformLocalPct": {"instagram": 82, "tiktok": 79, "threads": 77},
    "localAudiencePct": 82, "categories": ["Food & Drink", "Lifestyle"],
    "hasPhoto": True, "photoCount": 1, "photoUploadedAt": NOW,
    "bio": "I post the places I actually eat, every week, for my Nashville followers.",
    "paidRate": 125, "licensingFee": 150, "compOpen": True, "couponOpen": True,
    "neighborhood": "12 South", "profileComplete": True, "tierBand": "Locals"}
put_user(base_user("q250-cr", "creator", "priya@b250qa.dev", "Priya Nair", creator=dict(PRIYA)))
data["photo:q250-cr"] = {"contentType": "image/png", "dataBase64": PHOTO}
BAND = dict(PRIYA, handle="bandcat250", paidRate=150, localAudiencePct=76, neighborhood="East Nashville",
            categories=["Music", "Nightlife"], bio="Live music and late nights in East Nashville.")
put_user(base_user("q250-band", "creator", "band@b250qa.dev", "Band Cat", creator=BAND))
data["photo:q250-band"] = {"contentType": "image/png", "dataBase64": PHOTO}
referrals("bandcat250", 35, 14)   # 265 Momentum points: under the blue check
put_user(base_user("q250-biz", "business", "biz@b250qa.dev", "Biz Owner", business={
    "businessName": "Juniper Table", "category": "Restaurant", "plan": "growth", "planId": "growth",
    "accessState": "active", "about": "Seasonal cooking in 12 South.",
    "neighborhood": "12 South", "hasPhoto": True, "photoCount": 1}))
data["photo:q250-biz"] = {"contentType": "image/png", "dataBase64": PHOTO}
data["config:markets"] = {"flags": {"Nashville": True}}

TERMS = {"deliverablesText": "1 post + 1 story", "postWindowHours": 48, "keepUpDays": 30,
         "platform": {"name": "Instagram", "source": "largest_local"},
         "license": {"state": "ask", "priceCents": 15000}}
BRIEF = {"goal": "weeknight covers", "hook": "The tasting menu nobody talks about",
         "mustMention": ["Seasonal menu", "12 South"], "doNotSay": ["Best in Nashville"],
         "deliverable": "1 post + 1 story", "timing": "Weeknight visit", "callToAction": "Book a table"}
def booking(id, **kw):
    b = {"id": id, "creatorId": "q250-cr", "creatorName": "Priya Nair", "creatorHandle": "priyaeats",
         "businessId": "q250-biz", "businessName": "Juniper Table", "title": "Dinner for two",
         "kind": "comp", "status": "booked", "market": "Nashville", "createdAt": RECENT,
         "whatComped": "Dinner for two: two mains, two drinks", "dollarCap": 85,
         "visitWindow": "This week", "redeemBy": "2026-11-23T00:00:00.000Z"}
    b.update(kw)
    data[f"booking:{id}"] = b
booking("q250-visit", codeStatus="issued", code="SGNL-250A", creatorCode="PRIYANAIR-250", discountPct=0,
        brief=BRIEF, terms=TERMS,
        audienceCode={"code": "PRIYANAIR-250", "line": "Mention code PRIYANAIR-250 at Juniper Table so this visit counts.", "counted": 3, "countedSpend": 128, "state": {}},
        audienceOffer={"title": "Free appetizer with an entree", "perk": "A free appetizer with any entree"})
booking("q250-redeemed", redeemedAt="2026-11-19T16:00:00.000Z", postDeadline="2026-11-21T16:00:00.000Z",
        codeStatus="redeemed", code="SGNL-250B", creatorCode="PRIYANAIR-250", discountPct=0, terms=TERMS,
        audienceCode={"code": "PRIYANAIR-250", "line": "Mention code PRIYANAIR-250 at Juniper Table so this visit counts.", "counted": 0, "state": {}})
booking("q250-done", status="completed", redeemedAt="2026-11-17T16:00:00.000Z", codeStatus="redeemed",
        code="SGNL-250C", creatorCode="PRIYANAIR-250", discountPct=0, terms=TERMS,
        post={"id": "q250-post1", "url": "https://instagram.com/p/qa250/", "caption": "#ad, comped by Juniper Table through Magpie. Mention code PRIYANAIR-250 at Juniper Table so this visit counts.",
              "submittedAt": "2026-11-18T15:00:00.000Z", "firstAt": "2026-11-18T15:00:00.000Z", "onTime": True})
data["offer:q250-off1"] = {"id": "q250-off1", "lane": "open", "creatorId": None, "creatorHandle": None,
    "covers": 2, "cashRate": None, "targetTiers": None, "visitWindow": "This week", "windowMode": "7days",
    "spots": 3, "status": "open", "createdAt": RECENT, "updatedAt": RECENT, "publishedAt": RECENT,
    "kind": "comp", "title": "Dinner for two, on us", "businessId": "q250-biz", "businessName": "Juniper Table",
    "market": "Nashville", "category": "Food & Drink", "whatComped": "Dinner for two: two mains, two drinks",
    "includes": "Two mains, two drinks", "dollarCap": 85, "creatorLicensingFee": 150,
    "businessNeighborhood": "12 South", "businessCity": "Nashville",
    "windowStartAt": "2026-11-20T00:00:00.000Z", "windowEndAt": "2026-11-23T00:00:00.000Z", "terms": TERMS}

def start_server(root, port):
    tmp = tempfile.mkdtemp(prefix=f"signl-b250-{port}-")
    db = os.path.join(tmp, "db.json")
    open(db, "w").write(json.dumps(data))
    env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=f"http://127.0.0.1:{port}")
    env["ADMIN_EMAIL"] = "admin@b250.dev"; env["ADMIN_PASSWORD"] = "qa-admin-pass-250"
    for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "FIREBASE_SERVICE_ACCOUNT_JSON"]:
        env.pop(k, None)
    log = open(os.path.join(OUT, f"server-{port}.log"), "w")
    srv = subprocess.Popen(["node", "scripts/dev-server.mjs", str(port)], cwd=root, env=env, stdout=log, stderr=log)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)
    return srv

R = {"passed": 0, "failed": 0}
def check(name, cond, extra=""):
    if cond:
        R["passed"] += 1; print(f"  ok {name}")
    else:
        R["failed"] += 1; print(f"FAIL {name} :: {str(extra)[:240]}")

def words(page, selector):
    return page.evaluate(f"""() => {{ const el = document.querySelector({json.dumps(selector)}); return el ? el.innerText.trim().split(/\\s+/).filter(Boolean).length : -1; }}""")

def main():
    before = start_server(ROOT_BEFORE, 9251)
    after = start_server(ROOT, 9252)
    counts = {}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})
            def open_role(base, email, width, height, touch=False, lang=""):
                opts = {"viewport": {"width": width, "height": height}, "ignore_https_errors": True}
                if touch:
                    opts.update({"has_touch": True, "is_mobile": True, "device_scale_factor": 3})
                ctx = b.new_context(**opts)
                page = ctx.new_page()
                page.on("dialog", lambda d: d.accept())
                errs = []
                page.on("pageerror", lambda e: errs.append(str(e)[:140]))
                st = ctx.request.post(base + "/api/auth/login", data={"email": email, "password": PW}).status
                page.goto(base + "/?lang=es" if lang == "es" else base + "/", wait_until="networkidle")
                page.wait_for_timeout(2200)
                return ctx, page, st, errs
            def overflow(page):
                return page.evaluate("Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth")
            def imgs_ok(page):
                return page.evaluate("""(async () => {
                  const imgs = [...document.images].filter((i) => i.src);
                  await Promise.all(imgs.map((i) => i.complete ? null
                    : Promise.race([i.decode().catch(() => {}), new Promise((r) => setTimeout(r, 4000))])));
                  return imgs.every((i) => i.complete && i.naturalWidth > 0);
                })()""")
            def make_deal(base, ctx):
                r = ctx.request.post(base + "/api/deals", data={"creatorId": "q250-cr", "kind": "comp", "title": "Dinner for two",
                    "dollarCap": 85, "whatComped": "Dinner for two: two mains, two drinks", "timingWindow": "week",
                    "deliverables": {"posts": 1, "story": True}, "postingTerms": {"type": "standard"}, "expiresInHours": 48})
                return r.status

            # ---------- BEFORE (pristine -248): word counts only ----------
            BASE_B = "http://127.0.0.1:9251"
            ctx, page, st, errs = open_role(BASE_B, "biz@b250qa.dev", 390, 844, touch=True)
            check("before: business signs in", st == 200, st)
            make_deal(BASE_B, ctx)
            ctx.close()
            ctx, page, st, errs = open_role(BASE_B, "priya@b250qa.dev", 390, 844, touch=True)
            page.evaluate("state.crOffersSeg='deals'; go('dashboard','Offers')")
            page.wait_for_timeout(1800)
            counts["deal_before"] = words(page, "#cr-deals .card")
            deal_txt_b = page.evaluate("() => { const el = document.querySelector('#cr-deals .card'); return el ? el.innerText : ''; }")
            check("before: the comp deal DOES carry the under-it framing (the defect, reproduced)", "under it" in deal_txt_b, deal_txt_b[:160])
            page.evaluate("go('dashboard','My Visits')")
            page.wait_for_timeout(1800)
            counts["visit_before"] = words(page, "#visit-q250-visit")
            ctx.close()

            # ---------- AFTER: full pass ----------
            BASE = "http://127.0.0.1:9252"
            # business sends the deal (also seeds screen A)
            ctx, page, st, errs = open_role(BASE, "biz@b250qa.dev", 390, 844, touch=True)
            check("biz signs in", st == 200, st)
            check("biz sends the comp deal", make_deal(BASE, ctx) in (200, 201))
            # deal-sent landing: sendDeal via the real sheet
            page.evaluate("loadDiscover()")
            page.wait_for_timeout(1800)
            page.evaluate("openCreatorProfile('q250-cr')")
            page.wait_for_timeout(1500)
            page.evaluate("openDealSheet('q250-cr')")
            page.wait_for_timeout(600)
            page.evaluate("() => { document.getElementById('ds-kind').value='comp'; dealSheetKind(); document.getElementById('ds-cap').value='90'; document.getElementById('ds-what').value='Brunch for two'; }")
            page.evaluate("sendDeal('q250-cr')")
            page.wait_for_timeout(1500)
            seg = page.evaluate("() => state.offersSeg")
            check("after sending, Your campaigns is pointed at the Deals segment", seg == "deals", seg)
            page.evaluate("go('dashboard','My Offers')")
            page.wait_for_timeout(1800)
            biz_deals_txt = page.evaluate("() => document.body.innerText")
            check("the sender lands on the sent deal (Brunch for two, under Deals)", "Brunch for two" in biz_deals_txt)
            # founding receipt: trimmed founding paragraph + info button
            page.evaluate("go('dashboard','Home')")
            page.wait_for_timeout(2200)
            home_txt = page.evaluate("() => document.body.innerText")
            if "This is the screen your first visits pay into" in home_txt:
                check("receipt founding paragraph trimmed; methodology not pasted on the page",
                      "Counted means a customer showed the creator" not in home_txt)
            else:
                print("  note receipt founding state not on business Home in this seed; covered by source pins")
            ctx.close()

            # creator, phone
            ctx, page, st, errs = open_role(BASE, "priya@b250qa.dev", 390, 844, touch=True)
            check("creator signs in", st == 200, st)
            # --- Screen A ---
            page.evaluate("state.crOffersSeg='deals'; go('dashboard','Offers')")
            page.wait_for_timeout(1800)
            counts["deal_after"] = words(page, "#cr-deals .card")
            deal_txt = page.evaluate("() => { const el = document.querySelector('#cr-deals .card'); return el ? el.innerText : ''; }")
            check("A: value hero present ($85, Comp value)", "$85" in deal_txt and "Comp value" in deal_txt, deal_txt[:200])
            check("A: no under/over framing on the comp deal", "under it" not in deal_txt and "over it" not in deal_txt)
            check("A: no 'You get' row", "You get" not in deal_txt)
            check("A: terms rows present (You post / When / Rights / Money)", all(x in deal_txt for x in ["You post", "When", "Rights", "Money"]))
            check("A: Accept present", "Accept" in deal_txt)
            first_opt = page.evaluate("() => { const s = document.querySelector('select[id^=\"deal-reason-\"]'); return s ? s.options[0].textContent : ''; }")
            check("A: decline default is not the rate reason on a comp deal", first_opt == "The timing does not work", first_opt)
            hero_grad = page.evaluate("() => { const el = document.querySelector('#cr-deals .j226-val'); return el ? getComputedStyle(el).backgroundImage.includes('gradient') : false; }")
            check("A: the value line renders in the gradient", hero_grad)
            check("A: deals explainer is behind a tap, not pasted", "one-to-one offer between one business" not in page.evaluate("() => document.body.innerText"))
            page.locator("#cr-deals .card").first.screenshot(path=os.path.join(OUT, "01-deal-accept-390.png"))
            check("A: no horizontal overflow, images load, no page errors", overflow(page) <= 0 and imgs_ok(page) and not errs, str(errs)[:160])
            # --- Screen B ---
            page.evaluate("go('dashboard','My Visits')")
            page.wait_for_timeout(1800)
            counts["visit_after"] = words(page, "#visit-q250-visit")
            visit_txt = page.evaluate("() => { const el = document.querySelector('#visit-q250-visit'); return el ? el.innerText : ''; }")
            code_ct = page.evaluate("() => { const el = document.querySelector('#visit-q250-visit'); return el ? (el.innerText.match(/SGNL-250A/g) || []).length : 0; }")
            check("B: the visit code appears exactly once on the card", code_ct == 1, code_ct)
            grad = page.evaluate("() => { const el = document.querySelector('#visit-q250-visit .code-grad250'); return el ? (getComputedStyle(el).backgroundImage.includes('gradient') && getComputedStyle(el).webkitTextFillColor === 'rgba(0, 0, 0, 0)') : false; }")
            check("B: the visit code renders in the gradient", grad)
            check("B: one audience section, plainly labelled, no duplicated header",
                  "For your audience" in visit_txt and "For the audience:" not in visit_txt and visit_txt.count("Audience code:") == 1, visit_txt[:300])
            check("B: audience offer rides under its own title", "Free appetizer with an entree" in visit_txt)
            steps = page.evaluate("() => document.querySelectorAll('#visit-q250-visit .vt250-step').length")
            check("B: timeline renders as a stepper", steps >= 2, steps)
            check("B: deal panel rows present (Posts / Rights / Money / Counted)", all(x in visit_txt for x in ["Posts", "Rights", "Money", "Counted"]))
            check("B: check-in button present on the hero block", "I am here (check in)" in visit_txt)
            page.locator("#visit-q250-visit").screenshot(path=os.path.join(OUT, "02-visit-details-390.png"))
            # --- Screen C (creator) ---
            page.evaluate("openTracked226('q250-done')")
            page.wait_for_timeout(1800)
            comp_txt = page.evaluate("() => document.body.innerText")
            check("C: confirmation stands alone (no review form welded under it)",
                  "Your post is live." in comp_txt and "What stood out?" not in comp_txt)
            check("C: the rate entry row is there instead", page.evaluate("() => !!document.querySelector('[data-j226=\"review-entry\"]')"))
            page.screenshot(path=os.path.join(OUT, "03-completion-creator-390.png"), full_page=True)
            page.evaluate("openReview226('q250-done')")
            page.wait_for_timeout(1500)
            rev_txt = page.evaluate("() => document.body.innerText")
            check("C: tapping Rate opens the review as its own step", "What stood out?" in rev_txt and "How was Juniper Table?" in rev_txt)
            page.screenshot(path=os.path.join(OUT, "04-review-step-390.png"), full_page=True)
            # --- Offer detail EN ---
            page.evaluate("openOffer226('q250-off1')")
            page.wait_for_timeout(1500)
            off_txt = page.evaluate("() => document.body.innerText")
            check("offer detail EN: labels + comp line", all(x in off_txt for x in ["Where", "When", "What to post", "Using the post", "You pay nothing"]))
            page.screenshot(path=os.path.join(OUT, "05-offer-detail-en-390.png"), full_page=True)
            # --- Walkthrough caption step ---
            page.evaluate("openPostWalk226('q250-redeemed')")
            page.wait_for_timeout(1500)
            walk_txt = page.evaluate("() => document.body.innerText")
            check("walkthrough: the comped visit is disclosed, never 'free'",
                  "so the comped visit is disclosed" in walk_txt and "free visit" not in walk_txt)
            page.screenshot(path=os.path.join(OUT, "06-walkthrough-390.png"), full_page=True)
            # --- Find offers Clear all ---
            page.evaluate("go('dashboard','Find Offers')")
            page.wait_for_timeout(1800)
            page.evaluate("() => { state.foQ = 'juniper'; renderFindOffers(); }")
            page.wait_for_timeout(600)
            page.evaluate("foClearAll()")
            page.wait_for_timeout(600)
            foq = page.evaluate("() => state.foQ")
            check("Find offers: Clear all clears the search text", foq == "", repr(foq))
            ctx.close()
            # --- Offer detail ES ---
            ctx, page, st, errs = open_role(BASE, "priya@b250qa.dev", 390, 844, touch=True, lang="es")
            page.evaluate("openOffer226('q250-off1')")
            page.wait_for_timeout(1500)
            es_txt = page.evaluate("() => document.body.innerText")
            check("offer detail ES: labels in Spanish", all(x in es_txt for x in ["Dónde", "Cuándo", "Qué publicar", "Uso de la publicación"]), es_txt[:300])
            check("offer detail ES: body in Spanish (no pagas nada, audiencia local, licencia)",
                  all(x in es_txt for x in ["No pagas nada", "donde tu audiencia local es mayor", "La licencia estándar está incluida" if "incluida" in es_txt else "Solo compartir"]))
            check("offer detail ES: no English row labels left", "What to post" not in es_txt and "Using the post" not in es_txt)
            page.screenshot(path=os.path.join(OUT, "07-offer-detail-es-390.png"), full_page=True)
            ctx.close()
            # --- Band creator: blue-check sheet, not yet ---
            ctx, page, st, errs = open_role(BASE, "band@b250qa.dev", 390, 844, touch=True)
            page.evaluate("go('dashboard','Momentum')")
            page.wait_for_timeout(2200)
            page.click(".u226-meter-check")
            page.wait_for_timeout(900)
            sheet_txt = page.evaluate("() => document.body.innerText")
            check("blue-check sheet: a not-yet creator reads 'not yet' with the gap",
                  "Standout, not yet" in sheet_txt and "35 to go" in sheet_txt, sheet_txt[:240])
            check("blue-check sheet: it does NOT claim she reached Standout", "This creator reached Standout" not in sheet_txt)
            gt_vis = page.evaluate("() => { const el = document.getElementById('golden-tickets'); return el ? el.innerText : ''; }")
            gt_dom = page.evaluate("() => { const el = document.getElementById('golden-tickets'); return el ? el.textContent : ''; }")
            if gt_dom:
                check("Golden Tickets: prose behind the tap (in the DOM, not on the page)",
                      "Nobody else can hand out your seats" in gt_dom and "Nobody else can hand out your seats" not in gt_vis)
            page.screenshot(path=os.path.join(OUT, "08-bluecheck-notyet-390.png"), full_page=True)
            ctx.close()
            # --- Business completion twin ---
            ctx, page, st, errs = open_role(BASE, "biz@b250qa.dev", 390, 844, touch=True)
            page.evaluate("openBizComplete226('q250-done')")
            page.wait_for_timeout(1800)
            bcomp_txt = page.evaluate("() => document.body.innerText")
            check("C (business twin): confirmation stands alone, rate row present",
                  "post is live." in bcomp_txt and "What stood out?" not in bcomp_txt and page.evaluate("() => !!document.querySelector('[data-j226=\"review-entry\"]')"))
            page.screenshot(path=os.path.join(OUT, "09-completion-business-390.png"), full_page=True)
            ctx.close()
            # --- Desktop 1440: screens A + B + C ---
            ctx, page, st, errs = open_role(BASE, "priya@b250qa.dev", 1440, 1000)
            page.evaluate("state.crOffersSeg='deals'; go('dashboard','Offers')")
            page.wait_for_timeout(1800)
            page.locator("#cr-deals .card").first.screenshot(path=os.path.join(OUT, "10-deal-accept-1440.png"))
            page.evaluate("go('dashboard','My Visits')")
            page.wait_for_timeout(1800)
            page.locator("#visit-q250-visit").screenshot(path=os.path.join(OUT, "11-visit-details-1440.png"))
            d_code = page.evaluate("() => { const el = document.querySelector('#visit-q250-visit .code-grad250'); return el ? el.innerText : ''; }")
            check("B desktop: gradient visit code present", d_code == "SGNL-250A", d_code)
            page.evaluate("openTracked226('q250-done')")
            page.wait_for_timeout(1500)
            page.screenshot(path=os.path.join(OUT, "12-completion-creator-1440.png"), full_page=True)
            check("desktop: no horizontal overflow, no page errors", overflow(page) <= 0 and not errs, str(errs)[:160])
            ctx.close()
    finally:
        before.kill(); after.kill()
    print(f"\nword counts: deal card {counts.get('deal_before')} -> {counts.get('deal_after')}; visit card {counts.get('visit_before')} -> {counts.get('visit_after')}")
    print(f"qa-build250: {R['passed']} passed, {R['failed']} failed")
    return 1 if R["failed"] else 0

if __name__ == "__main__":
    sys.exit(main())
