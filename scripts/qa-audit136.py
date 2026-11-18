#!/usr/bin/env python3
"""Build -136 closing gate: FULL-APP fresh-eyes + wiring audit.

Walks EVERY rail destination for creator, business, partner and
admin, desktop + 390px, asserting rendered content per screen:
non-blank, no error artifacts (undefined / NaN / [object), no
horizontal overflow on mobile, no nameless buttons, and a live
Sig type-in box on every role home (standing rule). Findings are
written to the QA notes folder as audit-136.md.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

APP = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build136-qa")
PORT = 9092
BASE = f"http://127.0.0.1:{PORT}"
os.makedirs(OUT, exist_ok=True)

PW = "qa-pass-136"
SALT = "qa136salt"
HASH = subprocess.run(["node", "-e",
    "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
    PW, SALT], capture_output=True, text=True, check=True).stdout.strip()
PNG1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

def u(uid, **kw):
    d = {"id": uid, "passwordHash": HASH, "passwordSalt": SALT, "status": "approved",
         "createdAt": "2026-09-01T00:00:00.000Z", "tester": False}
    d.update(kw); return d

data = {}
data["user:bizqa"] = u("bizqa", role="business", email="biz@qa136.dev", name="QA Cuts Owner",
    market="Hampton Roads", business={"businessName": "QA Cuts", "legalName": "QA Cuts LLC",
    "category": "Beauty & Grooming", "address": "100 Ghent Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550100", "website": "", "accessState": "active"},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["user:trackbiz"] = u("trackbiz", role="business", email="track@qa136.dev", name="Track Owner",
    market="Hampton Roads", business={"businessName": "Track Record Tacos", "legalName": "TRT LLC",
    "category": "Restaurant", "address": "200 Colley Ave", "city": "Norfolk", "state": "VA",
    "zip": "23517", "neighborhood": "Ghent", "phone": "7575550101", "website": "", "hasPhoto": True, "photoCount": 1},
    businessOnboarded=True, subscription={"tier": "growth", "status": "founding", "credits": 10})
data["photo:trackbiz"] = {"contentType": "image/png", "dataBase64": PNG1, "bytes": 68, "uploadedAt": "2026-10-01T00:00:00.000Z"}
data["user:mayabakes"] = u("mayabakes", role="creator", email="maya@qa136.dev", name="Maya Rivers", city="Norfolk", market="Hampton Roads",
    creator={"name": "Maya Rivers", "handle": "mayabakes", "platform": "Instagram",
    "handleNormalized": "mayabakes", "market": "Hampton Roads", "city": "Norfolk", "state": "VA",
    "neighborhood": "Ghent", "zip": "23510", "categories": ["Food & Drink"], "tierBand": "Locals",
    "compCategories": ["Restaurant meals"],
    "totalAudience": 10000, "audienceStack": {"instagram": 10000}, "platformFollowers": {"instagram": 10000},
    "localAudiencePct": 86, "paidRate": 150, "compOpen": True, "couponOpen": False, "profileComplete": True,
    "publicPage": True, "bio": "Norfolk baker. Sourdough, cakes, and the farmers market.",
    "avgViews": 4200, "topAudienceCities": ["Norfolk", "Virginia Beach"],
    "audienceMarkets": [{"market": "Hampton Roads", "pct": 86}],
    "bestWork": ["https://www.instagram.com/reel/Cabc123XYZ/"]})
data["user:partnerqa"] = u("partnerqa", role="partner", email="partner@qa136.dev", name="Pat Partner",
    market="Hampton Roads",
    partner={"name": "QA Media Group", "code": "QAMG", "type": "media", "contactName": "Pat Partner",
             "markets": ["Hampton Roads"], "status": "active", "agreementStatus": "signed",
             "agreementSignedAt": "2026-09-01T00:00:00.000Z", "demo": False})
data["user:adminqa"] = u("adminqa", role="admin", email="admin@qa136.dev", name="Admin QA", market="Hampton Roads")
data["offer:of1"] = {"id": "of1", "businessId": "trackbiz", "businessName": "Track Record Tacos",
    "market": "Hampton Roads", "category": "Restaurant", "kind": "comp",
    "title": "Taco night for two", "whatComped": "Two taco plates and two drinks",
    "includes": "Mats, towels and the smoothie after are on us", "experience": "",
    "dollarCap": 60, "covers": 2, "spots": 3, "status": "open",
    "createdAt": "2026-11-05T12:00:00.000Z", "publishedAt": "2026-11-05T12:00:00.000Z",
    "visitWindow": "Any evening this week",
    "deliverables": {"posts": 1, "story": True, "windowHours": 48}, "targetTiers": []}
for k in list(data.keys()):
    if k.startswith("user:"):
        data[f"email:{data[k]['email']}"] = {"userId": data[k]["id"]}

tmp = os.path.join(os.path.expanduser("~"), "workspace", "signl-app", ".qa136-audit")
os.makedirs(tmp, exist_ok=True)
tempfile.tempdir = tmp
dbpath = os.path.join(tmp, "db.json")
with open(dbpath, "w") as f: json.dump(data, f)
env = {k: v for k, v in os.environ.items() if not k.startswith(("STRIPE", "SIGNL_STRIPE")) and "TWILIO" not in k and "RESEND" not in k}
env.update({"SIGNL_LOCAL": "1", "SIGNL_MAIL_STUB": "1", "SIGNL_LOCAL_DB": dbpath,
            "SIGNL_TEST_ALLOW_BUSINESS": "1", "APP_URL": BASE})
srv = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=APP, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
    except Exception: time.sleep(0.5)

CTXOPTS = dict(proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"},
               ignore_https_errors=True)
RED_FLAGS = ["undefined", "NaN", "[object Object]", "null is not", "Cannot read properties"]

def login(ctx, email):
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": PW},
                         headers={"Content-Type": "application/json"})
    assert r.ok, f"login {email}: {r.status}"

rows = []       # (role, tab, chars, heading, flags)
problems = []   # human-readable findings

def probe(page, role, tab):
    page.wait_for_timeout(1100)
    info = page.evaluate("""() => {
      const body = document.querySelector('#tab-body') || document.body;
      const text = (body.innerText || '').trim();
      const heads = [...body.querySelectorAll('h1,h2,h3,.ws-title')].map(e => (e.innerText||'').trim()).filter(Boolean);
      const nameless = [...body.querySelectorAll('button')].filter(b => {
        const t = (b.innerText || '').trim(); const a = b.getAttribute('aria-label') || '';
        return !t && !a && b.offsetParent !== null;
      }).length;
      const textInputs = [...document.querySelectorAll('input[type="text"], input:not([type]), textarea')]
        .filter(i => i.offsetParent !== null).length;
      return { chars: text.length, heading: heads[0] || '', text: text.slice(0, 4000), nameless, textInputs };
    }""")
    flags = [f for f in RED_FLAGS if f in info["text"]]
    if info["chars"] < 40: flags.append("NEAR-BLANK VIEW")
    if info["nameless"]: flags.append(f"{info['nameless']} nameless button(s)")
    rows.append((role, tab, info["chars"], info["heading"][:60], "; ".join(flags)))
    return info

def walk(browser, role, email, width, height, mobile):
    ctx = browser.new_context(viewport={"width": width, "height": height},
                              has_touch=mobile, **CTXOPTS)
    login(ctx, email)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:120]))
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(2500)
    dests = page.evaluate("""() => {
      const out = []; const seen = new Set();
      document.querySelectorAll('[onclick]').forEach(e => {
        const m = (e.getAttribute('onclick') || '').match(/go\\('([^']+)',\\s*'([^']+)'\\)/);
        if (m) { const k = m[1] + '|' + m[2]; if (!seen.has(k)) { seen.add(k); out.push([m[1], m[2]]); } }
      });
      return out;
    }""")
    if not dests:
        problems.append(f"{role}: NO rail destinations discovered ({'mobile' if mobile else 'desktop'})")
    home_info = None
    for view, tab in dests:
        try:
            page.evaluate(f"go('{view}','{tab}')")
        except Exception as ex:
            problems.append(f"{role}/{tab}: go() threw {str(ex)[:80]}")
            continue
        info = probe(page, f"{role}{' m' if mobile else ''}", tab)
        if tab in ("Home", "Dashboard") and not mobile:
            home_info = info
        if mobile:
            ov = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
            if ov: problems.append(f"{role}/{tab} @390px: horizontal overflow")
    if home_info is not None and role in ("creator", "business", "partner"):
        if home_info["textInputs"] == 0:
            problems.append(f"{role} home: NO visible text input — the standing Sig type-in box may be missing")
    for e in errors[:4]:
        problems.append(f"{role} ({'mobile' if mobile else 'desktop'}): pageerror: {e}")
    ctx.close()

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chromium", args=["--no-sandbox"])
        for role, email in [("creator", "maya@qa136.dev"), ("business", "biz@qa136.dev"),
                            ("partner", "partner@qa136.dev"), ("admin", "admin@qa136.dev")]:
            walk(browser, role, email, 1280, 860, False)
            walk(browser, role, email, 390, 844, True)
        browser.close()
finally:
    srv.terminate()

lines = ["# Build -136 full-app audit (rendered walk, all roles, desktop + 390px)", "",
         "| Role | Tab | Chars | First heading | Flags |", "|---|---|---|---|---|"]
for r in rows:
    lines.append(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} |")
lines += ["", "## Problems", ""] + ([f"- {p}" for p in problems] or ["- none"])
report = "\n".join(lines)
with open(os.path.join(OUT, "audit-136.md"), "w") as f: f.write(report + "\n")
print(report)
print(f"\nAUDIT: {len(rows)} screens walked, {len(problems)} problems")
