#!/usr/bin/env python3
"""Build -151 rendered QA: the six health-report defects on a
production-shaped store, desktop 1440 + phone 390.

1. Creators list badges agree with the canonical completeness
   (seeded stale cache flags both ways; exactly one "Not
   finished" — the genuinely incomplete creator).
2. Stats: Suggestions resolve (never the eternal loading
   line); Businesses tab lists the real business; Revenue
   pipeline counts only non-tester businesses on resolving
   plans ($199 + $349 = $548/mo — the tester's $699 managed
   plan is nowhere in it).
3. Creator Find offers: the "V" business renders as
   "Food & Drink business in Nashville".
4. Business preview carries a Wallet step rendering plan,
   paid-lane bookings and receipts.
5. The handle repair runs through its sweep endpoint in the
   live server: Julie -> jewls1082, the query-tail record ->
   its own platform link's handle, the fragment record
   untouched.
6. Partners: the demo org's Team seats load (no "Partner not
   found"); Social: Facebook/LinkedIn say "no count on file
   yet" while Instagram shows its seeded count.
Every <img> asserted loaded; no horizontal overflow.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/fix151-qa-2026-11-08")
os.makedirs(OUT, exist_ok=True)
PORT = 9107
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-fix151-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = (pw) => crypto.scryptSync(pw, salt, 64).toString("hex");
const now = new Date().toISOString();
const T0 = "2026-11-05T00:00:00.000Z";
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "admin1", role: "admin", email: "admin@qa.dev", name: "Jeff Rimmer", passwordSalt: salt, passwordHash: hash("qa-admin-pass"), status: "approved", createdAt: T0, updatedAt: now });
const creator = (id, email, name, creator, pw) => putUser({ id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash(pw || "qa-creator-pass"), status: "approved", market: "Nashville", city: "Nashville", createdAt: T0, updatedAt: now, tester: false, creator });
creator("crgood", "good@qa.dev", "Good Creator", { handle: "goodcreator", primaryPlatform: "instagram", categories: ["Food & Drink"], audienceStack: { instagram: 9000 }, followerCount: 9000, totalAudience: 9000, localAudiencePct: 75, profileComplete: false, hasPhoto: false, bio: "Good Creator — Nashville food, daily posts and honest reviews." });
creator("crhalf", "half@qa.dev", "Half Done", { handle: "halfcreator", primaryPlatform: "instagram", categories: [], audienceStack: { instagram: 3000 }, followerCount: 3000, totalAudience: 3000, localAudiencePct: 40, profileComplete: true, hasPhoto: false, bio: "Half Done — still setting up." });
creator("crjulie", "julie@qa.dev", "Julie Rochefort", { handle: "https://www.instagram.com/jewls1082/", primaryPlatform: "instagram", instagramUrl: "https://instagram.com/https://www.instagram.com/jewls1082/", primaryProfileUrl: "https://instagram.com/https://www.instagram.com/jewls1082/", categories: ["Food & Drink"], audienceStack: { instagram: 5000 }, followerCount: 5000, totalAudience: 5000, localAudiencePct: 60, profileComplete: true, hasPhoto: false, bio: "Julie Rochefort — Richmond eats." });
creator("crbig", "big@qa.dev", "Big Creator", { handle: "_r=1&_t=ZT-9B3OKX5mPWw", primaryPlatform: "tiktok", tiktokHandle: "_r=1&_t=ZT-9B3OKX5mPWw", tiktokUrl: "https://www.tiktok.com/@_r=1&_t=ZT-9B3OKX5mPWw", primaryProfileUrl: "https://www.tiktok.com/@_r=1&_t=ZT-9B3OKX5mPWw", platformLinks: { tiktok: { url: "https://www.tiktok.com/@realbigcreator" } }, categories: ["Fitness"], audienceStack: { tiktok: 2249000 }, followerCount: 0, totalAudience: 2249000, localAudiencePct: 100, profileComplete: true, hasPhoto: false, bio: "Big Creator — fitness, everywhere." });
creator("crcandy", "candy@qa.dev", "Candy Bee", { handle: "@", primaryPlatform: "instagram", instagramUrl: "https://instagram.com/mccandybee", primaryProfileUrl: "https://instagram.com/@", categories: ["Beauty"], audienceStack: { instagram: 2500 }, followerCount: 2500, totalAudience: 2500, localAudiencePct: 70, profileComplete: true, hasPhoto: false, bio: "Candy Bee — beauty, local." });
creator("crfrag", "jonah@qa.dev", "Jonah Phillips", { handle: "exln=MXIxcXZvZjNvNmRmdg==", primaryPlatform: "tiktok", tiktokHandle: "exln=MXIxcXZvZjNvNmRmdg==", tiktokUrl: "https://www.tiktok.com/@exln=MXIxcXZvZjNvNmRmdg==", primaryProfileUrl: "https://www.tiktok.com/@exln=MXIxcXZvZjNvNmRmdg==", categories: ["Music"], audienceStack: { tiktok: 4000 }, followerCount: 0, totalAudience: 4000, localAudiencePct: 55, profileComplete: true, hasPhoto: false, bio: "Jonah Phillips — music." });
const biz = (id, email, name, business, extra) => putUser(Object.assign({ id, role: "business", email, name, passwordSalt: salt, passwordHash: hash("qa-biz-pass"), status: "approved", market: "Nashville", city: "Nashville", createdAt: T0, updatedAt: now, tester: false, business }, extra || {}));
biz("bizv", "v@qa.dev", "V Person", { businessName: "V", category: "Food & Drink", plan: "self-service", hasPhoto: false, about: "A kitchen." });
biz("bizreal", "chelsea@qa.dev", "Chelsea Friday", { businessName: "Chelsea Friday Furniture", category: "Other", plan: "growth", hasPhoto: false, about: "Furniture, made local." });
biz("biztester", "saltline@qa.dev", "Salt Line", { businessName: "Salt Line Test Kitchen", category: "Food & Drink", plan: "managed", hasPhoto: false, about: "Test kitchen." }, { tester: true });
data["offer:offv"] = { id: "offv", businessId: "bizv", businessName: "V", market: "Nashville", category: "Food & Drink", title: "Dinner for two, on us", kind: "comp", whatComped: "Dinner for two: two mains, two drinks, one dessert", covers: 2, dollarCap: 500, spots: 2, status: "open", createdAt: "2026-11-01T00:00:00.000Z", windowStartAt: "2026-11-06T00:00:00.000Z", windowEndAt: "2026-11-20T00:00:00.000Z", applicationsCloseAt: "2026-11-15T00:00:00.000Z" };
putUser({ id: "partnerdemo", role: "partner", email: "demo@qa.dev", name: "Demo Partner", passwordSalt: salt, passwordHash: hash("qa-partner-pass"), status: "approved", market: "Virginia Beach", createdAt: T0, updatedAt: now, tester: false, partner: { name: "Demo Media Group", type: "media", code: "demo", markets: ["Virginia Beach"], sharePct: 60, status: "active", agreementStatus: "unsigned", demo: true } });
putUser({ id: "seat1", role: "partner", email: "seat@qa.dev", name: "Seat Person", passwordSalt: salt, passwordHash: hash("qa-partner-pass"), status: "approved", createdAt: T0, updatedAt: now, partner: { teamOf: "partnerdemo", name: "Seat Person" } });
data["config:markets"] = { flags: { "Nashville": true, "Virginia Beach": true } };
data["config:recruiterKitEmailV1Sent"] = { version: 1, claimedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z", recipients: [] };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE,
           ADMIN_EMAIL="admin@qa.dev", ADMIN_PASSWORD="qa-admin-pass", SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_SWEEP_TOKEN="qa-sweep-token")
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
    print(("ok - " if cond else "FAIL - ") + name + ((" :: " + str(detail)[:240]) if detail else ""))

def api_post(path, body, token=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **({"x-signl-sweep-token": token} if token else {})})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=60) as res:
        return res.status, json.loads(res.read().decode() or "{}")

try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def login(ctx, email, pw):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
            assert r.status == 200, f"login {email} -> {r.status}"

        def boot_page(ctx):
            page = ctx.new_page()
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
            page.wait_for_timeout(900)
            return page

        def facts(page):
            return page.evaluate("""() => {
              const imgs = [...document.images];
              return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                       imgTotal: imgs.length,
                       imgBroken: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).length };
            }""")

        def rail(page, label):
            page.locator(f".rail-item[aria-label='{label}']").first.click(timeout=5000)

        # ---------- admin, desktop ----------
        ctx = b.new_context(viewport={"width": 1440, "height": 950})
        login(ctx, "admin@qa.dev", "qa-admin-pass")
        page = boot_page(ctx)

        # 1. Creators list badges
        rail(page, "Creators")
        page.wait_for_function("() => document.body.innerText.includes('Half Done')", timeout=30000)
        page.wait_for_timeout(600)
        rows = page.evaluate("""() => [...document.querySelectorAll('tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' '))""")
        notfin = [r for r in rows if "Not finished" in r]
        check("creators: exactly one Not finished row", len(notfin) == 1, f"{len(notfin)} rows: {notfin}")
        check("creators: the Not finished row is the genuinely incomplete creator", len(notfin) == 1 and "Half Done" in notfin[0])
        good_row = [r for r in rows if "Good Creator" in r]
        check("creators: the complete creator (stale-false cache) reads Complete", len(good_row) == 1 and "Complete" in good_row[0] and "Not finished" not in good_row[0], good_row)
        f = facts(page); check("creators: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=os.path.join(OUT, "01-admin-creators-1440.png"), full_page=True)

        # 5. handle repair through the live sweep endpoint
        st, rep = api_post("/api/admin/repairs/handles", {"dryRun": True}, token="qa-sweep-token")
        check("repair: dry-run reports 3 recoverable + 1 unrecoverable", st == 200 and len(rep["repair"]["changed"]) == 3 and len(rep["repair"]["unrecoverable"]) == 1, rep.get("repair"))
        st, rep = api_post("/api/admin/repairs/handles", {}, token="qa-sweep-token")
        check("repair: run lands", st == 200 and len(rep["repair"]["changed"]) == 3, rep.get("repair"))
        # A full reload: clicking the already-active rail item
        # does not refetch, and the old URL handle contains the
        # new handle as a substring — only a fresh render proves
        # the repair.
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
        page.wait_for_timeout(700)
        rail(page, "Creators")
        page.wait_for_function("() => document.body.innerText.includes('@jewls1082')", timeout=30000)
        page.wait_for_timeout(500)
        body = page.evaluate("() => document.body.innerText")
        check("repair: Creators list now shows @jewls1082", "@jewls1082" in body or "jewls1082" in body)
        rows2 = page.evaluate("""() => [...document.querySelectorAll('tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' '))""")
        check("repair: query-tail record now shows @realbigcreator", "realbigcreator" in body, rows2)
        check("repair: unrecoverable fragment left exactly as it was", "exln=MXIxcXZvZjNvNmRmdg==" in body)
        page.screenshot(path=os.path.join(OUT, "02-admin-creators-repaired-1440.png"), full_page=True)

        # 2. Stats: suggestions resolve; Businesses + Revenue reconcile
        rail(page, "Stats")
        page.wait_for_function("() => { const h = document.getElementById('ast-suggest'); return h && h.innerText.includes('Suggestions') && !h.innerText.includes('Loading suggestions'); }", timeout=45000)
        check("stats: suggestions panel resolves (no eternal loading line)", True)
        page.evaluate("astSetView('businesses')")
        page.wait_for_timeout(400)
        page.evaluate("ccSetTab('businesses')")
        page.wait_for_function("() => { const h = document.getElementById('cc-body'); return h && h.innerText.includes('Chelsea Friday Furniture'); }", timeout=30000)
        ccbody = page.evaluate("() => document.getElementById('cc-body').innerText")
        check("stats/businesses: the real business is listed", "Chelsea Friday Furniture" in ccbody)
        check("stats/businesses: tester business excluded from the list", "Salt Line Test Kitchen" not in ccbody)
        page.screenshot(path=os.path.join(OUT, "03-stats-businesses-1440.png"), full_page=True)
        page.evaluate("astSetView('revenue')")
        page.wait_for_function("() => { const h = document.getElementById('ast-revenue'); return h && h.innerText.includes('Founding pipeline'); }", timeout=30000)
        rev = page.evaluate("() => document.getElementById('ast-revenue').innerText")
        check("stats/revenue: pipeline is $548/mo (199 real + 349 real)", "$548/mo" in rev, rev.replace("\n", " | ")[:300])
        check("stats/revenue: the tester's $699 managed plan is not counted", "$1,247" not in rev and "Managed" not in rev)
        page.screenshot(path=os.path.join(OUT, "04-stats-revenue-1440.png"), full_page=True)

        # 6a. Partners seats
        rail(page, "Partners")
        page.wait_for_function("() => document.body.innerText.includes('Demo Media Group')", timeout=30000)
        page.wait_for_function("() => document.body.innerText.includes('Seat Person')", timeout=30000)
        body = page.evaluate("() => document.body.innerText")
        check("partners: demo org team seats load", "Seat Person" in body)
        check("partners: no 'Partner not found' anywhere", "Partner not found" not in body and "Seats could not load" not in body)
        page.screenshot(path=os.path.join(OUT, "05-admin-partners-1440.png"), full_page=True)

        # 6b. Social honest counts
        rail(page, "Social")
        page.wait_for_function("() => document.body.innerText.includes('no count on file yet')", timeout=30000)
        body = page.evaluate("() => document.body.innerText")
        check("social: uncounted channels say 'no count on file yet'", body.count("no count on file yet") >= 2, f"count={body.count('no count on file yet')}")
        check("social: Instagram shows its seeded count 1,016", "1,016" in body)
        page.screenshot(path=os.path.join(OUT, "06-admin-social-1440.png"), full_page=True)

        # 4. Preview Wallet (desktop)
        page.evaluate("enterPreview()")
        page.wait_for_function("() => document.body.innerText.includes('The founding plans')", timeout=30000)
        page.locator(".tabs button", has_text="Wallet").first.click(timeout=5000)
        page.wait_for_function("() => document.body.innerText.includes('Bookings — the paid lane')", timeout=30000)
        page.wait_for_timeout(500)
        body = page.evaluate("() => document.body.innerText")
        check("preview: Wallet step renders plan, paid bookings, receipts", all(s in body for s in ["Wallet", "Plan", "Receipts", "Monthly talent budget", "creator keeps"]))
        check("preview: Wallet shows the current plan price", "$349/mo" in body or "$199/mo" in body or "$699/mo" in body, "")
        f = facts(page); check("preview wallet: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=os.path.join(OUT, "07-preview-wallet-1440.png"), full_page=True)
        page.evaluate("exitPreview()")
        page.wait_for_timeout(600)
        ctx.close()

        # 4b. Preview Wallet at 390
        ctxm = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctxm, "admin@qa.dev", "qa-admin-pass")
        pagem = boot_page(ctxm)
        pagem.evaluate("enterPreview()")
        pagem.wait_for_function("() => document.body.innerText.includes('The founding plans')", timeout=30000)
        pagem.locator(".tabs button", has_text="Wallet").first.click(timeout=5000)
        pagem.wait_for_function("() => document.body.innerText.includes('Bookings — the paid lane')", timeout=30000)
        pagem.wait_for_timeout(500)
        f = facts(pagem); check("preview wallet 390: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        pagem.screenshot(path=os.path.join(OUT, "08-preview-wallet-390.png"), full_page=True)
        ctxm.close()

        # ---------- creator, desktop + mobile ----------
        ctxc = b.new_context(viewport={"width": 1440, "height": 950})
        login(ctxc, "good@qa.dev", "qa-creator-pass")
        pagec = boot_page(ctxc)
        pagec.locator("button, a", has_text="Find Offers").first.click(timeout=8000)
        pagec.wait_for_function("() => document.body.innerText.includes('Food & Drink business in Nashville')", timeout=30000)
        pagec.wait_for_timeout(600)
        body = pagec.evaluate("() => document.body.innerText")
        check("find offers: fragment business renders as the category/market label", "Food & Drink business in Nashville" in body)
        check("find offers: the offer itself is present", "Dinner for two, on us" in body)
        broken = pagec.evaluate("""() => [...document.images].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute('src') || i.currentSrc || '(no src)')""")
        f = facts(pagec); check("find offers: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, {**f, "broken": broken})
        pagec.screenshot(path=os.path.join(OUT, "09-creator-find-offers-1440.png"), full_page=True)
        ctxc.close()

        ctxcm = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctxcm, "good@qa.dev", "qa-creator-pass")
        pagecm = boot_page(ctxcm)
        pagecm.locator("button, a", has_text="Find Offers").first.click(timeout=8000)
        pagecm.wait_for_function("() => document.body.innerText.includes('Food & Drink business in Nashville')", timeout=30000)
        pagecm.wait_for_timeout(500)
        f = facts(pagecm); check("find offers 390: no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        pagecm.screenshot(path=os.path.join(OUT, "10-creator-find-offers-390.png"), full_page=True)
        ctxcm.close()
        b.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()

print()
print("qa-fix151:", "ALL OK" if not FAILS else f"FAILURES: {FAILS}")
sys.exit(1 if FAILS else 0)
