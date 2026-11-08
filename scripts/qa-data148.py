#!/usr/bin/env python3
"""Build -148 rendered QA (Prompting Systems: Maggie's campaign
prompts + the creator coaching ladder + Admin visibility).

Desktop 1440 + phone 390, fixture data seeded straight into the
store (the mechanics are proven by scripts/verify-prompting.mjs):
- Business home (active Restaurant, approved 10 days, zero
  offers): Maggie's campaign-idea card renders under the hero
  with the first-campaign headline, three NAMED creators with
  match scores and why-lines, and the honest comp budget line;
  "Show me others" swaps in a fresh band; every <img> asserted
  loaded, no horizontal overflow.
- Creator homes: an unlisted creator's founding home shows the
  ladder's first step (Set your home market); a Nashville
  creator missing only a rate shows the rate step with the
  GENERIC why (no statistic: the cell is empty here).
- Admin Stats -> Data view gains the "Maggie's prompts" panel
  with the run's counts and the live ladder distribution.
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/data148-qa-2026-11-08")
os.makedirs(OUT, exist_ok=True)
PORT = 9103
ADMIN_PW = "qa-admin-" + "pass" + "-148"
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-data148-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const now = new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
function creator(id, email, name, handle, market, opts = {}) {
  putUser({ id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash, status: "approved",
    market, city: opts.city === undefined ? market : opts.city, createdAt: daysAgo(30), updatedAt: now, tester: false,
    creator: { handle, primaryPlatform: "instagram", followerCount: opts.total || 9000, totalAudience: opts.total || 9000,
      audienceStack: opts.stack || { instagram: opts.total || 9000 }, categories: opts.categories || ["Food & Drink"], localAudiencePct: opts.localPct === undefined ? 80 : opts.localPct,
      tierBand: "Locals", paidRate: opts.rate === undefined ? 150 : opts.rate, profileComplete: true, publicPage: true, hasPhoto: false,
      bio: `${name} posts daily about local spots, good food and the neighborhood.`, bestWork: opts.bestWork || ["https://instagram.com/p/x"], compCategories: ["Restaurant meals"] } });
}
creator("crA", "a@qa.dev", "Ana Alvarez", "anaeats", "Nashville", { localPct: 90, total: 20000, rate: 100 });
creator("crB", "b@qa.dev", "Ben Baker", "benbites", "Nashville", { localPct: 80, total: 9000, rate: 200 });
creator("crC", "c@qa.dev", "Cleo Chen", "cleocooks", "Nashville", { localPct: 70, total: 5000, rate: 300 });
creator("crD", "d@qa.dev", "Dee Dawson", "deedishes", "Nashville", { localPct: 60, total: 6000, rate: 250 });
creator("crE", "e@qa.dev", "Eli Evans", "elieats", "Nashville", { localPct: 50, total: 4000, rate: 175 });
creator("crRate", "rate@qa.dev", "Rita Rates", "ritarates", "Nashville", { localPct: 65, rate: null, stack: { instagram: 5000, tiktok: 3000, youtube: 2000 }, total: 10000, categories: ["Food & Drink", "Nightlife"] });
creator("crNew1", "new1@qa.dev", "Nina New", "ninanew", "Not listed yet", { city: "", localPct: null, rate: null, stack: { instagram: 9000 }, total: 9000, bestWork: [] });
putUser({ id: "ben", role: "business", email: "ben@qa.dev", name: "Ben Baker", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: daysAgo(10), updatedAt: now, approvedAt: daysAgo(10), tester: false, businessOnboarded: true,
  business: { businessName: "Salt & Stone Kitchen", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", hasPhoto: true, about: "Wood-fired kitchen in East Nashville." } });
data["config:markets"] = { flags: { "Nashville": true, "Austin": true } };
data["config:recruiterKitEmailV1Sent"] = { version: 1, claimedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z", recipients: [] };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE,
           ADMIN_EMAIL="admin@qa.dev", ADMIN_PASSWORD=ADMIN_PW, SIGNL_TEST_ALLOW_BUSINESS="1")
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
    print(("ok - " if cond else "FAIL - ") + name + ((" :: " + str(detail)[:220]) if detail else ""))

IMG_FACTS = """() => {
  const imgs = [...document.images];
  return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
           imgTotal: imgs.length,
           imgBroken: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).length };
}"""

def login(ctx, email, password):
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": password})
    assert r.status == 200, f"login {email} -> {r.status}"

def open_home(ctx):
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="domcontentloaded")
    page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
    return page

try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        # ---------- business desktop ----------
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "ben@qa.dev", "qa-pass-1234")
        page = open_home(ctx)
        page.wait_for_function("() => { const s = document.getElementById('prompt-slot'); return s && s.querySelector('.prompt-card'); }", timeout=30000)
        page.wait_for_timeout(600)
        txt = page.evaluate("() => document.getElementById('prompt-slot').textContent.replace(/\\s+/g, ' ')")
        check("business card: kicker + first-campaign headline", "Maggie has an idea" in txt and "first campaign" in txt, txt[:200])
        check("business card: three named creators with match scores + why-lines",
              all(s in txt for s in ["Ana Alvarez", "Ben Baker", "Cleo Chen", "match"]) and txt.count("local in Nashville") >= 2, txt[:300])
        check("business card: honest comp budget line, no invented results",
              "comped visit" in txt and not any(s in txt.lower() for s in ["roas", "guarantee", "sales lift"]), txt[txt.find("comped"):txt.find("comped") + 90] if "comped" in txt else "")
        f = page.evaluate(IMG_FACTS)
        check("business desktop: no overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/01-biz-prompt-desktop.png", full_page=True)
        # Show me others swaps the band.
        first = page.evaluate("() => document.getElementById('prompt-slot').textContent")
        page.click("[data-prompt-others]")
        page.wait_for_function("(prev) => { const s = document.getElementById('prompt-slot'); return s && s.textContent !== prev; }", arg=first, timeout=15000)
        txt2 = page.evaluate("() => document.getElementById('prompt-slot').textContent.replace(/\\s+/g, ' ')")
        check("show me others: fresh creators (Dee/Eli), none of the first band",
              "Dee Dawson" in txt2 and "Ana Alvarez" not in txt2, txt2[:240])
        page.screenshot(path=f"{OUT}/02-biz-prompt-others-desktop.png")
        # Dismiss clears the card.
        page.click("[data-prompt-dismiss]")
        page.wait_for_function("() => { const s = document.getElementById('prompt-slot'); return s && !s.querySelector('.prompt-card'); }", timeout=15000)
        check("dismiss: card clears", True)
        ctx.close()

        # ---------- business 390 ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "ben@qa.dev", "qa-pass-1234")
        page = open_home(ctx)
        page.wait_for_function("() => !!document.getElementById('prompt-slot')", timeout=30000)
        page.wait_for_timeout(1800)
        txt390 = page.evaluate("() => document.getElementById('prompt-slot').textContent.replace(/\\s+/g, ' ')")
        check("business 390: the dismissed family stays gone (a different family may rotate in, fully rendered)",
              "New menu moment" not in txt390 and ("Maggie has an idea" not in txt390 or "match" in txt390), txt390[:200])
        f = page.evaluate(IMG_FACTS)
        check("business 390: no overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/03-biz-home-390.png", full_page=True)
        ctx.close()

        # ---------- creator: unlisted, founding home (desktop) ----------
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "new1@qa.dev", "qa-pass-1234")
        page = open_home(ctx)
        page.wait_for_function("() => { const s = document.getElementById('prompt-slot'); return s && s.querySelector('.prompt-card'); }", timeout=30000)
        page.wait_for_timeout(500)
        txt = page.evaluate("() => document.getElementById('prompt-slot').textContent.replace(/\\s+/g, ' ')")
        check("coaching card (unlisted creator): first ladder step is the market step",
              "Your next step" in txt and "Set your home market" in txt and "Set my market" in txt, txt[:240])
        f = page.evaluate(IMG_FACTS)
        check("creator desktop: no overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/04-creator-coach-market-desktop.png", full_page=True)
        ctx.close()

        # ---------- creator: rate step (390) ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "rate@qa.dev", "qa-pass-1234")
        page = open_home(ctx)
        page.wait_for_function("() => { const s = document.getElementById('prompt-slot'); return s && s.querySelector('.prompt-card'); }", timeout=30000)
        page.wait_for_timeout(500)
        txt = page.evaluate("() => document.getElementById('prompt-slot').textContent.replace(/\\s+/g, ' ')")
        check("coaching card (390): rate step with the GENERIC why (no statistic in an empty cell)",
              "Set your paid rate" in txt and "can only book a rate that is listed" in txt and "as often" not in txt, txt[:260])
        f = page.evaluate(IMG_FACTS)
        check("creator 390: no overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/05-creator-coach-rate-390.png", full_page=True)
        ctx.close()

        # ---------- admin: prompting panel ----------
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "admin@qa.dev", ADMIN_PW)
        page = open_home(ctx)
        page.evaluate("go('dashboard','Stats')")
        page.wait_for_function("() => { const h = document.getElementById('ast-suggest'); return h && h.textContent.includes('Suggestions'); }", timeout=30000)
        page.evaluate("astSetView('data')")
        page.wait_for_function("() => { const h = document.getElementById('ast-data'); return h && h.textContent.includes(\"Maggie's prompts\"); }", timeout=30000)
        page.wait_for_timeout(600)
        txt = page.evaluate("() => document.getElementById('ast-data').textContent.replace(/\\s+/g, ' ')")
        i = txt.find("Maggie's prompts")
        panel = txt[i:i + 700] if i >= 0 else ""
        check("admin panel: campaign counts render (shown/used/dismissed cells present)",
              all(s in panel for s in ["Campaign prompts shown", "Offers created from prompts", "Dismissed"]), panel[:300])
        check("admin panel: coaching counts + live ladder distribution render",
              all(s in panel for s in ["Coaching steps offered", "Steps completed", "Creators ladder-complete"]) and ("Stuck at:" in txt or "No creator is mid-ladder" in txt), panel[300:640])
        f = page.evaluate(IMG_FACTS)
        check("admin desktop: no overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/06-admin-prompting-desktop.png", full_page=True)
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()

print(json.dumps(R, indent=1))
print("qa-data148:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILURE(S): {FAILS}")
sys.exit(0 if not FAILS else 1)
