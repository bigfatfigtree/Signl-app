"""Shared seed for Match Engine v1 QA: builds the local DB dict.
Business: Salt Line Test Kitchen (Restaurant, Nashville, live via TEST_MODE).
Creators designed to exercise every match component:
  Ana   - exact category, high local %, rate in budget, 4/4 on-time in-market
          deliveries (reliability 100 + full track bonus), referral Momentum.
  Cara  - adjacent category (Nightlife), top local %, 1 delivery (reliability
          still neutral, small track bonus).
  Bob   - exact category, rate over budget, no history (neutral reliability).
  Dan   - wrong category (Fitness), top local %, 5 deliveries 4 on-time
          (real reliability + full track bonus).
  Eve   - exact category, low local %, no history: the cold-start case.
  Ref1/Ref2 - Ana's approved referrals (her Momentum + Your Line points).
"""
import base64, io, json, subprocess

PW = "qa-match-pass"
SALT = "qamatchsalt"
HASH = subprocess.run(["node", "-e",
    "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
    PW, SALT], capture_output=True, text=True, check=True).stdout.strip()
ADMIN_EMAIL, ADMIN_PW = "admin@qamatch.dev", "qamatch-admin-pass"


def png_bytes(w, h, rgb, label_rgb):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (w, h), rgb)
    d = ImageDraw.Draw(img)
    d.ellipse([w * 0.25, h * 0.1, w * 0.75, h * 0.9], fill=label_rgb)
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


PORTRAIT = png_bytes(600, 800, (58, 96, 140), (240, 220, 180))


def u(uid, **kw):
    d = {"id": uid, "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
         "createdAt": "2026-09-01T00:00:00.000Z", "tester": False}
    d.update(kw)
    return d


def creator(uid, email, name, handle, market, city, pct, stack, cats, created,
            paid=150, extra=None, cextra=None):
    c = {"handle": handle, "platform": "Instagram", "handleNormalized": handle,
         "city": city, "state": "TN", "neighborhood": "Germantown",
         "categories": cats, "tierBand": "Locals",
         "compCategories": ["Restaurant meals"],
         "audienceStack": stack, "totalAudience": sum(stack.values()),
         "followerCount": stack.get("instagram", 0),
         "localAudiencePct": pct, "paidRate": paid, "compOpen": True, "couponOpen": True,
         "profileComplete": True, "publicPage": True, "bio": f"{name} - local.",
         "avgViews": 3000, "audienceMarkets": []}
    if cextra:
        c.update(cextra)
    d = u(uid, role="creator", email=email, name=name, city=city, market=market,
          creator=c, createdAt=created)
    if extra:
        d.update(extra)
    return d


def booking(bid, creator_id, day, business="bizother"):
    return {"id": bid, "businessId": business, "businessName": "Other Kitchen",
            "market": "Nashville", "category": "Restaurant", "creatorId": creator_id,
            "creatorName": "", "creatorHandle": "", "offerId": None, "kind": "comp",
            "title": "Tasting visit", "whatComped": "Dinner for two", "dollarCap": 100,
            "code": f"CODE-{bid}", "codeStatus": "burned", "status": "completed",
            "redeemedAt": f"2026-10-{day:02d}T18:00:00.000Z",
            "createdAt": f"2026-10-{day:02d}T12:00:00.000Z",
            "updatedAt": f"2026-10-{day:02d}T18:00:00.000Z"}


def post(pid, booking_id, creator_id, day, on_time=True):
    return {"id": pid, "bookingId": booking_id, "creatorId": creator_id,
            "url": f"https://www.instagram.com/p/{pid}/", "onTime": on_time,
            "submittedAt": f"2026-10-{day:02d}T20:00:00.000Z",
            "reportedAt": f"2026-10-{day:02d}T20:00:00.000Z",
            "createdAt": f"2026-10-{day:02d}T20:00:00.000Z"}


def build():
    data = {}
    data["user:bizmatch"] = u("bizmatch", role="business", email="owner@qamatch.dev",
        name="Salt Line Owner", market="Nashville",
        business={"businessName": "Salt Line Test Kitchen", "legalName": "SLTK LLC",
                  "category": "Restaurant", "address": "100 Union St", "city": "Nashville",
                  "state": "TN", "zip": "37201", "neighborhood": "Downtown",
                  "phone": "6155550100", "website": ""},
        businessOnboarded=True,
        subscription={"tier": "growth", "status": "active", "credits": 10})
    data["user:bizother"] = u("bizother", role="business", email="other@qamatch.dev",
        name="Other Owner", market="Nashville",
        business={"businessName": "Other Kitchen", "legalName": "OK LLC",
                  "category": "Restaurant", "address": "200 Main St", "city": "Nashville",
                  "state": "TN", "zip": "37201", "neighborhood": "Downtown",
                  "phone": "6155550101", "website": ""},
        businessOnboarded=True,
        subscription={"tier": "growth", "status": "active", "credits": 10})

    data["user:crana"] = creator("crana", "ana@qamatch.dev", "Ana Alvarez", "anaeats",
        "Nashville", "Nashville", 88, {"instagram": 12000}, ["Food & Drink"],
        "2026-09-01T00:00:00.000Z", paid=150,
        cextra={"hasPhoto": True, "instagramUrl": "https://instagram.com/anaeats"})
    data["user:crbob"] = creator("crbob", "bob@qamatch.dev", "Bob Baker", "bobbakes",
        "Nashville", "Nashville", 82, {"instagram": 9000}, ["Food & Drink"],
        "2026-09-02T00:00:00.000Z", paid=300,
        cextra={"instagramUrl": "https://instagram.com/bobbakes"})
    data["user:crcara"] = creator("crcara", "cara@qamatch.dev", "Cara Chen", "caranights",
        "Nashville", "Nashville", 91, {"instagram": 5000}, ["Nightlife"],
        "2026-09-03T00:00:00.000Z", paid=180,
        cextra={"instagramUrl": "https://instagram.com/caranights"})
    data["user:crdan"] = creator("crdan", "dan@qamatch.dev", "Dan Doyle", "danlifts",
        "Nashville", "Nashville", 95, {"instagram": 8000}, ["Fitness & Wellness"],
        "2026-09-04T00:00:00.000Z", paid=100,
        cextra={"instagramUrl": "https://instagram.com/danlifts"})
    data["user:creve"] = creator("creve", "eve@qamatch.dev", "Eve Ellis", "eveeats",
        "Nashville", "Nashville", 40, {"instagram": 3000}, ["Food & Drink"],
        "2026-09-05T00:00:00.000Z", paid=120,
        cextra={"instagramUrl": "https://instagram.com/eveeats"})
    data["user:crref1"] = creator("crref1", "ref1@qamatch.dev", "Rae One", "raeone",
        "Nashville", "Nashville", 30, {"instagram": 1500}, ["Music"],
        "2026-09-06T00:00:00.000Z", paid=100, extra={"referredBy": "anaeats"},
        cextra={"instagramUrl": "https://instagram.com/raeone"})
    data["user:crref2"] = creator("crref2", "ref2@qamatch.dev", "Rae Two", "raetwo",
        "Nashville", "Nashville", 25, {"instagram": 1200}, ["Music"],
        "2026-09-07T00:00:00.000Z", paid=100, extra={"referredBy": "anaeats"},
        cextra={"instagramUrl": "https://instagram.com/raetwo"})

    for i, day in enumerate([3, 10, 17, 24]):
        data[f"booking:bk-ana-{i}"] = booking(f"bk-ana-{i}", "crana", day)
        data[f"post:post-ana-{i}"] = post(f"post-ana-{i}", f"bk-ana-{i}", "crana", day, True)
    data["booking:bk-cara-0"] = booking("bk-cara-0", "crcara", 12)
    data["post:post-cara-0"] = post("post-cara-0", "bk-cara-0", "crcara", 12, True)
    for i, day in enumerate([2, 9, 16, 23, 30]):
        data[f"booking:bk-dan-{i}"] = booking(f"bk-dan-{i}", "crdan", day)
        data[f"post:post-dan-{i}"] = post(f"post-dan-{i}", f"bk-dan-{i}", "crdan", day, i != 2)

    data["photo:crana"] = {"contentType": "image/png", "dataBase64": PORTRAIT,
                           "bytes": 1000, "uploadedAt": "2026-09-02T00:00:00.000Z"}
    for uid in ["bizmatch", "bizother", "crana", "crbob", "crcara", "crdan", "creve", "crref1", "crref2"]:
        data[f"email:{data['user:' + uid]['email']}"] = {"userId": uid}
    return data
