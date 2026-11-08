#!/usr/bin/env python3
"""Maggie Rebuild v1 QA (Jeff, 2026-11-07).

Rendered proof for the rebuild, desktop 1440 + phone 390:
- every role home carries the working Maggie chat box, and her
  head MOVES (computed animation on Jeff's tiles, transforms
  sampled twice — a frozen bird fails);
- "hey" in Admin (Jeff's exact failing probe) and in the other
  lanes gets a conversation, never the retired deflection;
- the Sig/Maggie tab hero animates by state (data-mode think
  while she works);
- the match join: with a simulated match payload on
  /api/discover (the engine lives on the parallel branch; the
  payload shape is its published contract — matchScore +
  match { score, parts, reasons } + matchBrief), Maggie's B2
  ranks by match over local %, speaks Find's line, and renders
  Find's card language (Match N, why-line, Top match, Book);
  without it, the same flow degrades to local-% ranking and
  Invite, exactly as before;
- UX walk data per surface: box presence, nudge count,
  horizontal overflow at 390.
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app-maggie")
OUT = os.path.expanduser("~/workspace/research_notes/maggie-rebuild-qa-2026-11-07")
os.makedirs(OUT, exist_ok=True)
PORT = 9097
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-maggie-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const now = "2026-11-07T14:00:00.000Z";
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "carly", role: "creator", email: "carly@qa.dev", name: "Carly Creator", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: now, updatedAt: now,
  creator: { handle: "carlycreates", primaryPlatform: "instagram", followerCount: 5200, totalAudience: 5200, audienceStack: { instagram: 5200 }, categories: ["Food & Drink"], localAudiencePct: 92, tierBand: "Locals", paidRate: 300, profileComplete: true, publicPage: true, hasPhoto: true, photoCount: 1, bio: "Nashville food creator." } });
putUser({ id: "dana", role: "creator", email: "dana@qa.dev", name: "Dana Dishes", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: now, updatedAt: now,
  creator: { handle: "danadishes", primaryPlatform: "instagram", followerCount: 9100, totalAudience: 9100, audienceStack: { instagram: 9100 }, categories: ["Food & Drink"], localAudiencePct: 70, tierBand: "Locals", paidRate: 150, profileComplete: true, publicPage: true, hasPhoto: true, photoCount: 1, bio: "Nashville baker and brunch hunter." } });
putUser({ id: "penny", role: "creator", email: "penny@qa.dev", name: "Penny Pending", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: now, updatedAt: now,
  creator: { handle: "pennypending", primaryPlatform: "instagram", followerCount: 800, totalAudience: 800, audienceStack: { instagram: 800 }, categories: ["Music"], localAudiencePct: 60, tierBand: "Neighbors", profileComplete: false, publicPage: false, bio: "New here." } });
putUser({ id: "ben", role: "business", email: "ben@qa.dev", name: "Ben Baker", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: now, updatedAt: now,
  business: { businessName: "Salt & Stone Kitchen", category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "active", hasPhoto: true, about: "Wood-fired kitchen." } });
putUser({ id: "pat", role: "partner", email: "pat@qa.dev", name: "Pat Partner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: now, updatedAt: now,
  partner: { name: "QA Media Group", code: "qamedia", markets: ["Nashville"], sharePct: 20, status: "active", contactName: "Pat Partner", email: "pat@qa.dev" } });
const photo = fs.readFileSync(process.argv[3]);
data["photo:carly"] = { contentType: "image/jpeg", dataBase64: photo.toString("base64") };
const photo2 = fs.readFileSync(process.argv[4]);
data["photo:dana"] = { contentType: "image/jpeg", dataBase64: photo2.toString("base64") };
data["config:markets"] = { flags: { "Nashville": true } };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db, os.path.join(ROOT, "public/assets/maggie-char/curious.jpg"), os.path.join(ROOT, "public/assets/maggie-char/greet.jpg")], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE,
           ADMIN_EMAIL="admin@qa.dev", ADMIN_PASSWORD="qa-admin-pass")
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "SIG_AI_API_KEY", "SIG_AI_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
R = {}
FAILS = []
def check(name, cond, detail=""):
    R[name] = detail if detail else ("ok" if cond else "FAIL")
    if not cond:
        FAILS.append(name)
    print(("ok - " if cond else "FAIL - ") + name + ((" :: " + str(detail)[:180]) if detail else ""))

MATCH_PAYLOAD = {
    "creators": [
        {"userId": "dana", "name": "Dana Dishes", "market": "Nashville", "neighborhood": "East Nashville", "totalAudience": 9100, "isFavorite": False,
         "profile": {"handle": "danadishes", "localAudiencePct": 70, "categories": ["Food & Drink"], "paidRate": 150, "tierBand": "Locals"},
         "matchScore": 91, "match": {"score": 91, "parts": {}, "reasons": ["70% local in Nashville", "Posts Food & Drink", "$150 rate fits your budget"]}},
        {"userId": "carly", "name": "Carly Creator", "market": "Nashville", "neighborhood": "Germantown", "totalAudience": 5200, "isFavorite": False,
         "profile": {"handle": "carlycreates", "localAudiencePct": 92, "categories": ["Food & Drink"], "paidRate": 300, "tierBand": "Locals"},
         "matchScore": 62, "match": {"score": 62, "parts": {}, "reasons": ["92% local in Nashville", "Posts Food & Drink"]}},
    ],
    "universities": [],
    "matchBrief": {"source": "filters", "category": "Food & Drink", "budget": 200, "kind": "paid", "market": "Nashville"},
}

try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def login(ctx, email, pw="qa-pass-1234"):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
            assert r.status == 200, f"login {email} -> {r.status}"

        def boot_page(ctx, width=1440):
            page = ctx.new_page()
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
            page.wait_for_timeout(900)
            return page

        def box_facts(page):
            return page.evaluate("""() => {
              const box = document.querySelector('.sigtop130 .sigbox130') || document.querySelector('.sigbox130');
              if (!box) return { box: false };
              const head = box.querySelector('.maggie-char-head img');
              const cs = head ? getComputedStyle(head) : null;
              const nudges = document.querySelectorAll('#sigtop-nudges .sigtop-nudge').length;
              return { box: true, headSrc: head ? head.getAttribute('src') : null,
                       headAnim: cs ? cs.animationName : null,
                       nudges, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
            }""")

        def box_ask(page, text):
            page.fill("#sigbox-input-home", text)
            page.press("#sigbox-input-home", "Enter")
            page.wait_for_function("""() => {
              const t = document.getElementById('sigbox-thread-home');
              return t && !t.hidden && t.querySelectorAll('.sig-turn.sig .sig-bub').length > 0 &&
                ![...t.querySelectorAll('.sig-turn.sig .sig-bub')].some((b) => b.textContent.includes('One sec.'));
            }""", timeout=20000)
            return page.evaluate("""() => {
              const t = document.getElementById('sigbox-thread-home');
              const bubs = t ? [...t.querySelectorAll('.sig-turn.sig .sig-bub')] : [];
              const last = bubs[bubs.length - 1];
              const ava = t ? t.querySelector('.sig-turn.sig:last-child .sig-ava-char img') : null;
              return { text: last ? last.textContent.trim() : '', avaAnim: ava ? getComputedStyle(ava).animationName : null };
            }""")

        # ================= CREATOR =================
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "carly@qa.dev")
        page = boot_page(ctx)
        f = box_facts(page)
        check("creator home: Maggie box present at top", f["box"], f)
        check("creator home: her head is Jeff's greet tile and it MOVES", (f.get("headSrc") or "").endswith("maggie-char/greet.jpg") and f.get("headAnim") not in (None, "none"), f)
        r = box_ask(page, "hey")
        check("creator home box: 'hey' gets a conversation", "Maggie" in r["text"] and "bag" not in r["text"], r["text"][:160])
        check("creator home box: her live avatar animates while she talks", r["avaAnim"] not in (None, "none"), r)
        page.screenshot(path=f"{OUT}/01-creator-home-desktop.png")

        page.evaluate("go('dashboard','Sig')")
        page.wait_for_selector("[data-sig-hero-media].maggie-char-hero", timeout=20000)
        page.wait_for_timeout(600)
        hero1 = page.evaluate("""() => {
          const host = document.querySelector('[data-sig-hero-media].maggie-char-hero');
          const img = host.querySelector('.maggie-char-poster');
          return { mode: host.getAttribute('data-mode'), anim: getComputedStyle(img).animationName,
                   t: getComputedStyle(img).transform, src: img.getAttribute('src') };
        }""")
        page.wait_for_timeout(1000)
        hero2 = page.evaluate("""() => getComputedStyle(document.querySelector('[data-sig-hero-media].maggie-char-hero .maggie-char-poster')).transform""")
        check("creator Maggie tab: hero is Jeff's tile artwork, animated (greet hop on entry)", hero1["src"].startswith("/assets/maggie-char/") and hero1["anim"] != "none", hero1)
        check("creator Maggie tab: hero transform actually changes over time (she is not still)", hero1["t"] != hero2, f'{hero1["t"]} vs {hero2}')
        # The greet is a one-shot: she settles back to idle on the curious tile.
        try:
            page.wait_for_function("() => document.querySelector('[data-sig-hero-media].maggie-char-hero').getAttribute('data-mode') === 'idle'", timeout=12000)
            settled = page.evaluate("() => document.querySelector('[data-sig-hero-media].maggie-char-hero .maggie-char-poster').getAttribute('src')")
            check("creator Maggie tab: hero settles to idle on the curious tile", settled.endswith("maggie-char/curious.jpg"), settled)
        except Exception:
            check("creator Maggie tab: hero settles to idle on the curious tile", False, "data-mode never returned to idle")
        page.fill("#sig-ask-input", "how many points do I have")
        page.press("#sig-ask-input", "Enter")
        page.wait_for_function("""() => {
          const t = document.getElementById('sig-thread');
          return t && [...t.querySelectorAll('.sig-turn.sig .sig-bub')].some((b) => /Momentum|points/i.test(b.textContent)) &&
            ![...t.querySelectorAll('.sig-turn.sig .sig-bub')].some((b) => b.textContent.includes('One sec.'));
        }""", timeout=20000)
        thtxt = page.evaluate("() => document.getElementById('sig-thread').textContent")
        check("creator Maggie tab: a numbers question is answered in-thread", "Momentum" in thtxt and "bag" not in thtxt, thtxt[-200:])
        page.screenshot(path=f"{OUT}/02-creator-maggie-tab-desktop.png")
        ctx.close()

        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "carly@qa.dev")
        page = boot_page(ctx, 390)
        f = box_facts(page)
        check("creator home 390: box present, head moves, no horizontal overflow", f["box"] and f.get("headAnim") not in (None, "none") and not f["overflow"], f)
        page.screenshot(path=f"{OUT}/03-creator-home-390.png")
        ctx.close()

        # ================= BUSINESS =================
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "ben@qa.dev")
        page = boot_page(ctx)
        f = box_facts(page)
        check("business home: Maggie box present, head moves", f["box"] and f.get("headAnim") not in (None, "none"), f)
        r = box_ask(page, "hey")
        check("business home box: 'hey' gets a conversation", "Maggie" in r["text"] and "bag" not in r["text"], r["text"][:160])
        page.screenshot(path=f"{OUT}/04-business-home-desktop.png")

        # B2 without the engine: local-% ranking, Invite (degradation in the real UI).
        page.evaluate("go('dashboard','Sig')")
        page.wait_for_selector("#sig-ask-input", timeout=20000)
        page.evaluate("sigB2Start()")
        page.wait_for_timeout(500)
        page.fill("#sig-ask-input", "food creators")
        page.press("#sig-ask-input", "Enter")
        page.wait_for_selector(".sig-ccard", timeout=20000)
        page.wait_for_timeout(400)
        plain = page.evaluate("""() => {
          const cards = [...document.querySelectorAll('.sig-ccard')];
          const first = cards[0];
          return { n: cards.length,
                   firstName: first ? first.querySelector('.sig-ccard-name').textContent.trim() : '',
                   firstBtn: first ? first.querySelector('.sig-ccard-acts .btn').textContent.trim() : '',
                   hasMatch: !!document.querySelector('.sig-ccard-match'),
                   line: (document.querySelector('#sig-thread').textContent.match(/Found [^]*?ranked by[^.]*\\./) || [''])[0] };
        }""")
        check("business B2 no-engine: ranked by local reach (Carly 92% first)", plain["n"] >= 2 and "Carly" in plain["firstName"], plain)
        check("business B2 no-engine: no match language, action is Invite", (not plain["hasMatch"]) and plain["firstBtn"] == "Invite" and "how local" in plain["line"], plain)
        page.screenshot(path=f"{OUT}/05-business-b2-plain-desktop.png")

        # B2 with the (simulated) engine payload: the join.
        page.route("**/api/discover*", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(MATCH_PAYLOAD)))
        page.evaluate("state.sigThread = []; state.sigFlow = null; sigB2Start()")
        page.wait_for_timeout(500)
        page.fill("#sig-ask-input", "food creators under $200")
        page.press("#sig-ask-input", "Enter")
        page.wait_for_selector(".sig-ccard-match", timeout=20000)
        page.wait_for_timeout(400)
        m = page.evaluate("""() => {
          const cards = [...document.querySelectorAll('.sig-ccard')];
          const first = cards[0];
          const thread = document.getElementById('sig-thread').textContent;
          return { n: cards.length,
                   firstName: first ? first.querySelector('.sig-ccard-name').textContent.trim() : '',
                   firstBtn: first ? first.querySelector('.sig-ccard-acts .btn').textContent.trim() : '',
                   matchText: first ? first.querySelector('.sig-ccard-match').textContent.trim().replace(/\\s+/g, ' ') : '',
                   topTag: first ? !!first.querySelector('.sig-ccard-topmatch') : false,
                   rankedLine: (thread.match(/ranked by match[^.]*\\./) || [''])[0] };
        }""")
        check("business B2 match: match order beats local order (Dana 91 over Carly 92% local)", m["n"] == 2 and "Dana" in m["firstName"], m)
        check("business B2 match: Find's line is spoken (ranked by match, brief named)", "ranked by match" in m["rankedLine"] and "Food & Drink" in m["rankedLine"] and "$200" in m["rankedLine"], m["rankedLine"])
        check("business B2 match: card speaks Find's language (Match 91 + why + Top match + Book)", m["matchText"].startswith("Match 91") and "70% local in Nashville" in m["matchText"] and m["topTag"] and m["firstBtn"] == "Book", m)
        page.screenshot(path=f"{OUT}/06-business-b2-match-desktop.png")
        ctx.close()

        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "ben@qa.dev")
        page = boot_page(ctx, 390)
        f = box_facts(page)
        check("business home 390: box present, no horizontal overflow", f["box"] and not f["overflow"], f)
        page.screenshot(path=f"{OUT}/07-business-home-390.png")
        ctx.close()

        # ================= ADMIN =================
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "admin@qa.dev", "qa-admin-pass")
        page = boot_page(ctx)
        page.evaluate("go('dashboard','Applications')")
        page.wait_for_selector("#admin-sig", timeout=20000)
        page.wait_for_timeout(1200)
        f = box_facts(page)
        check("admin home: Maggie box present at top, head moves", f["box"] and f.get("headAnim") not in (None, "none"), f)
        brief = page.evaluate("() => { const el = document.getElementById('admin-sig'); return el ? el.textContent.replace(/\\s+/g, ' ').slice(0, 220) : ''; }")
        check("admin home: the attention list renders real items (Penny is waiting)", "Penny" in brief or "waiting" in brief.lower(), brief)
        r = box_ask(page, "hey")
        check("ADMIN 'hey' (Jeff's probe): conversation with the real waiting count", "Maggie" in r["text"] and "1 application waiting" in r["text"] and "bag" not in r["text"], r["text"][:200])
        page.screenshot(path=f"{OUT}/08-admin-home-desktop.png")
        page.evaluate("go('dashboard','Sig')")
        page.wait_for_selector("#admin-sig-brief", timeout=20000)
        page.wait_for_timeout(1000)
        has = page.evaluate("() => ({ ask: !!document.getElementById('sig-ask-input'), hero: !!document.querySelector('[data-sig-hero-media].maggie-char-hero') })")
        check("admin Maggie destination: brief + hero + ask input render", has["ask"] and has["hero"], has)
        page.fill("#sig-ask-input", "hey")
        page.press("#sig-ask-input", "Enter")
        page.wait_for_function("""() => {
          const t = document.getElementById('sig-thread');
          return t && [...t.querySelectorAll('.sig-turn.sig .sig-bub')].some((b) => b.textContent.includes('Maggie')) &&
            ![...t.querySelectorAll('.sig-turn.sig .sig-bub')].some((b) => b.textContent.includes('One sec.'));
        }""", timeout=20000)
        atxt = page.evaluate("() => document.getElementById('sig-thread').textContent")
        check("admin Maggie destination: 'hey' converses there too", "Maggie" in atxt and "bag" not in atxt, atxt[-200:])
        page.screenshot(path=f"{OUT}/09-admin-maggie-desktop.png")
        ctx.close()

        # ================= PARTNER =================
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "pat@qa.dev")
        page = boot_page(ctx)
        f = box_facts(page)
        check("partner home: Maggie box present", f["box"], f)
        if f["box"]:
            r = box_ask(page, "hey")
            check("partner home box: 'hey' gets a conversation in the partner lane", "Maggie" in r["text"] and "bag" not in r["text"], r["text"][:160])
        page.screenshot(path=f"{OUT}/10-partner-home-desktop.png")
        ctx.close()

    print()
    print("RESULTS:", json.dumps(R, indent=1)[:3000])
    print("qa-maggie:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILURE(S): {FAILS}")
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except Exception: server.kill()
