#!/usr/bin/env python3
"""Build -146 rendered QA (Decision Reports as Admin Suggestions
+ Discover-grid brief threading).

Desktop 1440 + phone 390, real fixture data throughout:
- Admin Stats opens on the matured Suggestions panel: the
  Austin gate-watch card with its receipts (47 of 50, Lifestyle
  thinnest at 8), the waiting queue, the named cooling stall,
  the typed-city backlog, and Maggie's curriculum cluster —
  every card carrying its numbers, none an empty box.
- The gate card's door ("See the roster") records the taking
  and lands on the Stats creators view filtered to Austin; the
  acted card stays off the board afterwards. A dismissal
  persists across a full page reload.
- Brief threading through the REAL Discover grid: Best match +
  category + budget -> the resolved brief rides state into
  Book -> booking flow -> deal sheet -> Send -> the vdeal
  record in the store carries sourceBrief. Control: the same
  drive without a brief sends a deal with NO sourceBrief.
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/data146-qa-2026-11-08")
os.makedirs(OUT, exist_ok=True)
PORT = 9100
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-data146-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const now = new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const today = now.slice(0, 10);
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const creator = (id, email, name, handle, market, extra) => putUser(Object.assign({
  id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash, status: "approved",
  market, city: market, createdAt: daysAgo(30), updatedAt: now, tester: false,
  creator: { handle, primaryPlatform: "instagram", followerCount: 9000, totalAudience: 9000,
    audienceStack: { instagram: 9000 }, categories: ["Food & Drink"], localAudiencePct: 80,
    tierBand: "Locals", paidRate: 150, profileComplete: true, publicPage: true, hasPhoto: true, bio: name + " — local creator." },
}, extra || {}));
creator("crnash1", "nash1@qa.dev", "Nash Food One", "nashfoodone", "Nashville");
creator("crnash2", "nash2@qa.dev", "Nash Eats Two", "nashfoodtwo", "Nashville");
data["user:crnash2"].creator.paidRate = 300;
data["user:crnash2"].creator.localAudiencePct = 70;
creator("crquiet", "quiet@qa.dev", "Quiet Quinn", "quietquinn", "Nashville", { createdAt: daysAgo(40), updatedAt: daysAgo(40) });
putUser({ id: "crpending1", role: "creator", email: "pend1@qa.dev", name: "Pending One", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: daysAgo(2), updatedAt: now, tester: false,
  creator: { handle: "pendingone", totalAudience: 700, audienceStack: { instagram: 700 }, categories: ["Music"], localAudiencePct: 60, profileComplete: false, publicPage: false } });
putUser({ id: "crpending2", role: "creator", email: "pend2@qa.dev", name: "Pending Two", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: daysAgo(1), updatedAt: now, tester: false,
  creator: { handle: "pendingtwo", totalAudience: 650, audienceStack: { instagram: 650 }, categories: ["Music"], localAudiencePct: 55, profileComplete: false, publicPage: false } });
// Austin: 47 bookable creators across the launch categories.
const dist = [["Food & Drink", 12], ["Fitness & Wellness", 10], ["Beauty & Grooming", 9], ["Lifestyle", 8], ["Nightlife", 8]];
let n = 0;
for (const [cat, count] of dist) for (let i = 0; i < count; i++) {
  n += 1;
  creator("cratx" + n, "atx" + n + "@qa.dev", "Austin Creator " + n, "atxcreator" + n, "Austin", { createdAt: daysAgo(10) });
  data["user:cratx" + n].creator.categories = [cat];
}
for (let i = 1; i <= 6; i++) {
  putUser({ id: "crclark" + i, role: "creator", email: "clark" + i + "@qa.dev", name: "Clarksville " + i, passwordSalt: salt, passwordHash: hash, status: "approved", market: "Not listed yet", city: "Clarksville", state: "TN", createdAt: now, updatedAt: now, tester: false,
    creator: { handle: "clarksville" + i, totalAudience: 1200, audienceStack: { instagram: 1200 }, categories: ["Food & Drink"], localAudiencePct: 90, profileComplete: false, publicPage: false } });
}
putUser({ id: "ben", role: "business", email: "ben@qa.dev", name: "Ben Baker", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: daysAgo(30), updatedAt: now, tester: false, businessOnboarded: true,
  business: { businessName: "Salt & Stone Kitchen", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", hasPhoto: true, about: "Wood-fired kitchen." } });
data["offer:offsea"] = { id: "offsea", businessId: "ben", businessName: "Salt & Stone Kitchen", market: "Seattle", category: "Restaurant", kind: "paid", cashRate: 200, title: "Seattle opening night", status: "open", createdAt: daysAgo(2), updatedAt: daysAgo(2) };
// Maggie's curriculum corpus: four creator asks about pricing
// she could not really answer.
const asks = [
  ["crnash1", "how much should I charge for a post?", "unavailable"],
  ["crnash2", "what do businesses pay around here?", "unavailable"],
  ["crnash1", "is my rate too low for this market?", "convo"],
  ["crnash2", "what does a campaign cost a business?", "convo"],
];
asks.forEach(([actor, q, source], i) => {
  data[`event:${today}:qaask${i}`] = { id: "qaask" + i, ts: now, type: "sig_ask", actorId: actor, actorRole: "creator", subjectId: actor, market: "Nashville", data: { q, source, cards: false, link: false, action: false } };
});
data["config:markets"] = { flags: { "Nashville": true, "Austin": true } };
data["config:recruiterKitEmailV1Sent"] = { version: 1, claimedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z", recipients: [] };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE,
           ADMIN_EMAIL="admin@qa.dev", ADMIN_PASSWORD="qa-admin-pass", SIGNL_TEST_ALLOW_BUSINESS="1")
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

def read_db():
    with open(db) as f:
        return json.load(f)

def deals_for(creator_id):
    d = read_db()
    rows = [v for k, v in d.items() if k.startswith("vdeal:") and v.get("creatorId") == creator_id]
    return sorted(rows, key=lambda o: o.get("createdAt", ""))

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

        def boot_page(ctx):
            page = ctx.new_page()
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
            page.wait_for_timeout(900)
            return page

        def page_facts(page):
            return page.evaluate("""() => {
              const imgs = [...document.images];
              return {
                overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                imgTotal: imgs.length,
                imgBroken: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).length,
              };
            }""")

        def open_stats(page):
            page.evaluate("go('dashboard','Stats')")
            page.wait_for_function("() => { const h = document.getElementById('ast-suggest'); return h && h.textContent.includes('Suggestions'); }", timeout=30000)
            page.wait_for_timeout(700)

        # ================= ADMIN: the matured panel =================
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "admin@qa.dev", "qa-admin-pass")
        page = boot_page(ctx)
        open_stats(page)
        sug = page.evaluate("() => document.getElementById('ast-suggest').textContent.replace(/\\s+/g, ' ')")
        check("panel: gate card states the math (47 of 50, Lifestyle thinnest at 8) with receipts",
              "Austin is 3 creators from its business gate (47 of 50)" in sug and "Lifestyle is thinnest at 8" in sug and "creators: 47" in sug, sug[:300])
        check("panel: waiting queue, named cooling stall, backlog, and curriculum all render with numbers",
              "2 creator applications waiting on review" in sug and "Quiet Quinn" in sug and "gone quiet" in sug and "Clarksville" in sug and "pricing and money" in sug and "4 times" in sug, sug[:300])
        check("panel: every card carries a door and the receipts are not empty boxes",
              "See the roster" in sug and "Dismiss" in sug and "market: Austin" in sug, sug[:200])
        f = page_facts(page)
        check("panel desktop: no horizontal overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/01-suggestions-desktop.png")
        # The gate door: records the taking, lands on Austin's roster.
        page.evaluate("""() => {
          const rows = [...document.querySelectorAll('#ast-suggest .kv')];
          const row = rows.find((r) => r.textContent.includes('business gate'));
          const btn = [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === 'See the roster');
          btn.click();
        }""")
        page.wait_for_function("() => { try { return astView === 'creators' && astFilters.market === 'Austin'; } catch (e) { return false; } }", timeout=30000)
        page.wait_for_timeout(800)
        roster = page.evaluate("""() => {
          const sel = document.querySelector('#astview-creators select');
          const marketSel = [...document.querySelectorAll('select')].map((s) => s.value);
          return { filtered: astFilteredCreators().length, markets: marketSel,
                   txt: document.getElementById('tab-body').textContent.replace(/\\s+/g, ' ').slice(0, 400) };
        }""")
        check("door: lands on the Stats creators view filtered to Austin (47 creators in the filtered set)",
              roster["filtered"] == 47 and "Austin" in roster["markets"], roster)
        page.screenshot(path=f"{OUT}/02-gate-door-roster-desktop.png")
        # Back to Stats: the acted gate card is off the board; dismiss the waiting card and prove persistence.
        open_stats(page)
        sug2 = page.evaluate("() => document.getElementById('ast-suggest').textContent.replace(/\\s+/g, ' ')")
        check("acted: the gate card stays off the board after its door was taken", "business gate" not in sug2 and "Quiet Quinn" in sug2, sug2[:220])
        page.evaluate("""() => {
          const rows = [...document.querySelectorAll('#ast-suggest .kv')];
          const row = rows.find((r) => r.textContent.includes('waiting on review'));
          const btns = [...row.querySelectorAll('button')];
          btns[btns.length - 1].click();
        }""")
        page.wait_for_function("() => !document.getElementById('ast-suggest').textContent.includes('waiting on review')", timeout=20000)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
        open_stats(page)
        sug3 = page.evaluate("() => document.getElementById('ast-suggest').textContent.replace(/\\s+/g, ' ')")
        check("dismissal PERSISTS across a full reload; the rest of the board is intact",
              "waiting on review" not in sug3 and "Quiet Quinn" in sug3 and "Clarksville" in sug3, sug3[:220])
        page.screenshot(path=f"{OUT}/03-after-dismiss-desktop.png")
        ctx.close()

        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "admin@qa.dev", "qa-admin-pass")
        page = boot_page(ctx)
        open_stats(page)
        sugm = page.evaluate("() => document.getElementById('ast-suggest').textContent.replace(/\\s+/g, ' ')")
        f = page_facts(page)
        check("panel 390: renders with receipts, no horizontal overflow, every image loaded",
              "Quiet Quinn" in sugm and "creators:" in sugm and not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/04-suggestions-390.png", full_page=True)
        ctx.close()

        # ================= BUSINESS: grid brief threading =================
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "ben@qa.dev")
        page = boot_page(ctx)
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_selector("#f-sort", timeout=20000)
        page.wait_for_timeout(600)
        page.evaluate("""async () => {
          state.discoverCats = ['Food & Drink'];
          document.getElementById('f-sort').value = 'match';
          document.getElementById('f-budget').value = '200';
          await runDiscover();
        }""")
        page.wait_for_function("() => { const h = document.getElementById('match-hint'); return h && h.textContent.includes('Match scores are for'); }", timeout=20000)
        page.wait_for_timeout(500)
        brief = page.evaluate("() => state.discoverBrief || null")
        check("grid: the briefed run resolves a brief into client state (Food & Drink, $200, Nashville)",
              bool(brief) and brief.get("category") == "Food & Drink" and brief.get("budget") == 200 and brief.get("market") == "Nashville" and "label" not in brief, brief)
        page.evaluate("""() => {
          const btn = [...document.querySelectorAll('.shelf-acts .btn, .shelf-tray .btn')].find((x) => (x.getAttribute('onclick') || '').includes("startOffer('crnash2')"));
          btn.click();
        }""")
        page.wait_for_selector("input[name='bk-lane']", timeout=20000)
        snap = page.evaluate("() => state.bookingSourceBrief || null")
        check("grid: Book snapshots the brief into the booking flow", bool(snap) and snap.get("budget") == 200, snap)
        page.evaluate("""() => {
          document.querySelector("input[name='bk-lane'][value='comp']").click();
        }""")
        page.evaluate("""() => { [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Continue').click(); }""")
        page.wait_for_selector("#ds-title", timeout=20000)
        page.fill("#ds-title", "QA briefed deal")
        page.fill("#ds-cap", "75")
        page.fill("#ds-what", "Dinner for two")
        page.screenshot(path=f"{OUT}/05-briefed-deal-sheet-desktop.png")
        page.evaluate("""() => { [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Send the deal').click(); }""")
        page.wait_for_function("() => { const n = document.getElementById('ds-note'); return n && n.textContent.includes('Deal sent'); }", timeout=20000)
        rows = deals_for("crnash2")
        d1 = rows[-1] if rows else {}
        sb = d1.get("sourceBrief") or {}
        check("grid: the sent deal record persists sourceBrief from the briefed list",
              sb.get("category") == "Food & Drink" and sb.get("budget") == 200 and sb.get("source") == "filters" and "label" not in sb, sb)
        # Control: an unbriefed run books with no brief attached.
        page.evaluate("go('dashboard','Discover')")
        page.wait_for_selector("#f-sort", timeout=20000)
        page.wait_for_timeout(600)
        page.evaluate("""async () => {
          state.discoverCats = [];
          await runDiscover();
        }""")
        page.wait_for_selector(".shelf-tile", timeout=20000)
        page.wait_for_timeout(400)
        brief2 = page.evaluate("() => state.discoverBrief || null")
        check("grid control: the unbriefed run holds no brief", brief2 is None, brief2)
        page.evaluate("""() => {
          const btn = [...document.querySelectorAll('.shelf-acts .btn, .shelf-tray .btn')].find((x) => (x.getAttribute('onclick') || '').includes("startOffer('crnash1')"));
          btn.click();
        }""")
        page.wait_for_selector("input[name='bk-lane']", timeout=20000)
        page.evaluate("""() => { document.querySelector("input[name='bk-lane'][value='comp']").click(); }""")
        page.evaluate("""() => { [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Continue').click(); }""")
        page.wait_for_selector("#ds-title", timeout=20000)
        page.fill("#ds-title", "QA plain deal")
        page.fill("#ds-cap", "50")
        page.fill("#ds-what", "Dinner for two")
        page.evaluate("""() => { [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Send the deal').click(); }""")
        page.wait_for_function("() => { const n = document.getElementById('ds-note'); return n && n.textContent.includes('Deal sent'); }", timeout=20000)
        rows2 = deals_for("crnash1")
        d2 = rows2[-1] if rows2 else {}
        check("grid control: the unbriefed deal has NO sourceBrief (never inferred)",
              "sourceBrief" not in d2 and d2.get("title") == "QA plain deal", list(d2.keys()))
        page.screenshot(path=f"{OUT}/06-grid-brief-threading-desktop.png")
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()

print(json.dumps(R, indent=1))
print("qa-data146:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILURE(S): {FAILS}")
sys.exit(0 if not FAILS else 1)
