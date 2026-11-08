#!/usr/bin/env python3
"""Build -145 rendered QA (Data capture completion + Admin Data
view + Suggestions panel + the -144 brief-threading addendum).

Desktop 1440 + phone 390, real fixture data throughout:
- Admin Stats opens on the Suggestions panel with the fixture
  suggestions visible (Austin supply gap, waiting queue,
  Clarksville backlog); dismissing the gap persists across a
  full page reload (server-side dismissal).
- The Data view renders the real matrix (Austin Food & Drink
  0 supply / 1 demand), the funnel, capture health, backlog,
  reliability, snapshots and the export links; no horizontal
  overflow at either width; every <img> on the page loaded.
- Brief threading, driven through the real client: a briefed
  B2 run (typed criteria, real discover, real matchBrief) ->
  Book on the top card -> the flow state carries sourceBrief ->
  sigB1Commit -> the offer record in the store carries it.
  The same for Maggie's AI-card attach path (fabricated reply,
  real closure). Control: a brief-less sigB1Start commits an
  offer with NO sourceBrief — never inferred.
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/data145-qa-2026-11-08")
os.makedirs(OUT, exist_ok=True)
PORT = 9099
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-data145-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const now = "2026-11-07T14:00:00.000Z";
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const creator = (id, email, name, handle, market, extra) => putUser(Object.assign({
  id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash, status: "approved",
  market, city: market, createdAt: now, updatedAt: now, tester: false,
  creator: { handle, primaryPlatform: "instagram", followerCount: 9000, totalAudience: 9000,
    audienceStack: { instagram: 9000 }, categories: ["Food & Drink"], localAudiencePct: 80,
    tierBand: "Locals", paidRate: 150, profileComplete: true, publicPage: true, hasPhoto: true, bio: name + " — local creator." },
}, extra || {}));
creator("crnash1", "nash1@qa.dev", "Nash Food One", "nashfoodone", "Nashville");
creator("crnash2", "nash2@qa.dev", "Nash Eats Two", "nashfoodtwo", "Nashville");
data["user:crnash2"].creator.paidRate = 300;
data["user:crnash2"].creator.localAudiencePct = 70;
creator("craustin", "austin@qa.dev", "Austin Tunes", "austintunes", "Austin");
data["user:craustin"].creator.categories = ["Music"];
putUser({ id: "crpending1", role: "creator", email: "pend1@qa.dev", name: "Pending One", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: "2026-11-05T00:00:00.000Z", updatedAt: now, tester: false,
  creator: { handle: "pendingone", totalAudience: 700, audienceStack: { instagram: 700 }, categories: ["Music"], localAudiencePct: 60, profileComplete: false, publicPage: false } });
putUser({ id: "crpending2", role: "creator", email: "pend2@qa.dev", name: "Pending Two", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: "2026-11-06T00:00:00.000Z", updatedAt: now, tester: false,
  creator: { handle: "pendingtwo", totalAudience: 650, audienceStack: { instagram: 650 }, categories: ["Music"], localAudiencePct: 55, profileComplete: false, publicPage: false } });
for (let i = 1; i <= 6; i++) {
  putUser({ id: "crclark" + i, role: "creator", email: "clark" + i + "@qa.dev", name: "Clarksville " + i, passwordSalt: salt, passwordHash: hash, status: "approved", market: "Not listed yet", city: "Clarksville", state: "TN", createdAt: now, updatedAt: now, tester: false,
    creator: { handle: "clarksville" + i, totalAudience: 1200, audienceStack: { instagram: 1200 }, categories: ["Food & Drink"], localAudiencePct: 90, profileComplete: false, publicPage: false } });
}
putUser({ id: "ben", role: "business", email: "ben@qa.dev", name: "Ben Baker", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: now, updatedAt: now, tester: false, businessOnboarded: true,
  business: { businessName: "Salt & Stone Kitchen", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", hasPhoto: true, about: "Wood-fired kitchen." } });
data["offer:offeraustin"] = { id: "offeraustin", businessId: "ben", market: "Austin", category: "Restaurant", kind: "paid", cashRate: 200, title: "Austin opening night", status: "open", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" };
data["booking:bk1"] = { id: "bk1", offerId: "offeraustin", businessId: "ben", creatorId: "crnash1", market: "Nashville", status: "completed", createdAt: "2026-10-05T00:00:00.000Z", redeemedAt: "2026-10-06T00:00:00.000Z" };
data["booking:bk2"] = { id: "bk2", offerId: "offeraustin", businessId: "ben", creatorId: "crnash1", market: "Nashville", status: "completed", createdAt: "2026-10-07T00:00:00.000Z", redeemedAt: "2026-10-08T00:00:00.000Z" };
data["post:p1"] = { id: "p1", bookingId: "bk1", creatorId: "crnash1", url: "https://instagram.com/p/one", submittedAt: "2026-10-06T12:00:00.000Z", onTime: true };
data["post:p2"] = { id: "p2", bookingId: "bk2", creatorId: "crnash1", url: "https://instagram.com/p/two", submittedAt: "2026-10-09T12:00:00.000Z", onTime: false };
data["config:markets"] = { flags: { "Nashville": true, "Austin": true } };
data["cityrequest:req1"] = { city: "Franklin", region: "TN", handle: "franklinfoodie", createdAt: "2026-11-01T00:00:00.000Z" };
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

def offers_for(creator_id):
    d = read_db()
    rows = [v for k, v in d.items() if k.startswith("offer:") and v.get("creatorId") == creator_id]
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

        # ================= ADMIN: Suggestions + Data =================
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "admin@qa.dev", "qa-admin-pass")
        page = boot_page(ctx)
        page.evaluate("go('dashboard','Stats')")
        page.wait_for_function("() => { const h = document.getElementById('ast-suggest'); return h && h.textContent.includes('Suggestions'); }", timeout=30000)
        page.wait_for_timeout(600)
        sug = page.evaluate("() => document.getElementById('ast-suggest').textContent.replace(/\\s+/g, ' ')")
        check("admin Stats: Suggestions panel is at the top with the fixture calls visible",
              "No approved Food & Drink creators in Austin" in sug and "creator applications waiting on review" in sug and "Clarksville" in sug, sug[:260])
        page.screenshot(path=f"{OUT}/01-suggestions-desktop.png")
        # Dismiss the gap suggestion, then prove it survives a reload.
        page.evaluate("""() => {
          const rows = [...document.querySelectorAll('#ast-suggest .kv')];
          const row = rows.find((r) => r.textContent.includes('Food & Drink creators in Austin'));
          if (row) row.querySelector('button').click();
        }""")
        page.wait_for_function("() => !document.getElementById('ast-suggest').textContent.includes('Food & Drink creators in Austin')", timeout=20000)
        check("admin Stats: dismiss removes the gap suggestion", True)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
        page.evaluate("go('dashboard','Stats')")
        page.wait_for_function("() => { const h = document.getElementById('ast-suggest'); return h && h.textContent.includes('Suggestions'); }", timeout=30000)
        page.wait_for_timeout(600)
        sug2 = page.evaluate("() => document.getElementById('ast-suggest').textContent.replace(/\\s+/g, ' ')")
        check("admin Stats: the dismissal PERSISTS across a full reload", "Food & Drink creators in Austin" not in sug2 and "waiting on review" in sug2, sug2[:220])
        page.screenshot(path=f"{OUT}/02-suggestions-after-reload-desktop.png")
        # Data view.
        page.evaluate("astSetView('data')")
        page.wait_for_function("() => { const h = document.getElementById('ast-data'); return h && h.textContent.includes('Supply and demand'); }", timeout=30000)
        page.wait_for_timeout(500)
        dv = page.evaluate("""() => {
          const host = document.getElementById('ast-data');
          const txt = host.textContent.replace(/\\s+/g, ' ');
          const austinRow = [...host.querySelectorAll('table tr')].find((tr) => tr.textContent.trim().startsWith('Austin'));
          const exportLinks = [...host.querySelectorAll('a[href*=\"/api/admin/stats/data/export\"]')].length;
          return { txt: txt.slice(0, 400), austin: austinRow ? austinRow.textContent.replace(/\\s+/g, ' ') : '',
                   funnel: txt.includes('Match funnel'), health: txt.includes('Capture health'),
                   backlog: txt.includes('Franklin'), snaps: txt.includes('Daily snapshots'), exportLinks };
        }""")
        check("admin Data view: matrix renders the Austin gap cell (0 supply / 1 demand)", "0 / 1" in dv["austin"], dv["austin"])
        check("admin Data view: funnel, capture health, backlog (Franklin), snapshots all render",
              dv["funnel"] and dv["health"] and dv["backlog"] and dv["snaps"], dv["txt"])
        check("admin Data view: export links present for the datasets", dv["exportLinks"] >= 10, dv["exportLinks"])
        f = page_facts(page)
        check("admin Data view desktop: no horizontal overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/03-data-view-desktop.png", full_page=True)
        ctx.close()

        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "admin@qa.dev", "qa-admin-pass")
        page = boot_page(ctx)
        page.evaluate("go('dashboard','Stats')")
        page.wait_for_function("() => { const h = document.getElementById('ast-suggest'); return h && h.textContent.includes('Suggestions'); }", timeout=30000)
        page.evaluate("astSetView('data')")
        page.wait_for_function("() => { const h = document.getElementById('ast-data'); return h && h.textContent.includes('Supply and demand'); }", timeout=30000)
        page.wait_for_timeout(500)
        f = page_facts(page)
        dvtxt = page.evaluate("() => document.getElementById('ast-data').textContent.replace(/\\s+/g, ' ')")
        check("admin Data view 390: renders, no horizontal overflow, every image loaded", "Supply and demand" in dvtxt and "Match funnel" in dvtxt and not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/04-data-view-390.png", full_page=True)
        ctx.close()

        # ================= BUSINESS: brief threading =================
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "ben@qa.dev")
        page = boot_page(ctx)
        page.evaluate("go('dashboard','Sig')")
        page.wait_for_selector("#sig-ask-input", timeout=20000)
        page.evaluate("state.sigThread = []; state.sigFlow = null; sigB2Start()")
        page.wait_for_timeout(400)
        page.fill("#sig-ask-input", "food creators under $200")
        page.press("#sig-ask-input", "Enter")
        page.wait_for_selector(".sig-ccard", timeout=20000)
        page.wait_for_timeout(500)
        top_creator = page.evaluate("""() => {
          const card = document.querySelector('.sig-ccard');
          const btn = [...card.querySelectorAll('.sig-ccard-acts .btn')].find((x) => x.textContent.trim() === 'Book') || card.querySelector('.sig-ccard-acts .btn');
          btn.click();
          return new Promise((resolve) => setTimeout(() => resolve(state.sigFlow ? state.sigFlow.data.creatorId : null), 600));
        }""")
        flow = page.evaluate("() => state.sigFlow ? { brief: state.sigFlow.data.sourceBrief || null, lane: state.sigFlow.data.lane } : null")
        check("brief threading: Book on a briefed card starts the direct flow carrying sourceBrief",
              bool(flow) and flow["lane"] == "direct" and bool(flow["brief"]), flow)
        check("brief threading: the brief is the resolved one (Food & Drink, $200, Nashville, no display label)",
              bool(flow) and bool(flow["brief"]) and flow["brief"].get("category") == "Food & Drink" and flow["brief"].get("budget") == 200 and flow["brief"].get("market") == "Nashville" and "label" not in flow["brief"], flow)
        page.screenshot(path=f"{OUT}/05-b2-book-flow-desktop.png")
        await_commit = page.evaluate("""async () => {
          const d = state.sigFlow.data;
          d.kind = 'comp'; d.title = 'QA briefed visit'; d.comped = 'Dinner for two'; d.cap = 75;
          await sigB1Commit();
          return true;
        }""")
        page.wait_for_timeout(900)
        rows = offers_for(top_creator)
        briefed = rows[-1] if rows else {}
        check("brief threading: the committed offer record persists sourceBrief",
              "sourceBrief" in briefed and briefed["sourceBrief"].get("category") == "Food & Drink" and briefed["sourceBrief"].get("budget") == 200,
              (briefed.get("sourceBrief") or {}))
        # Maggie AI-card path: fabricated reply, the REAL attach closure.
        page.evaluate("""() => {
          state.sigFlow = null;
          const turn = {};
          const reply = { cards: [{ userId: 'crnash2', name: 'Nash Eats Two', matchScore: 88,
              match: { score: 88, parts: {}, reasons: ['70% local in Nashville'] },
              profile: { handle: 'nashfoodtwo', localAudiencePct: 70, categories: ['Food & Drink'], paidRate: 300, tierBand: 'Locals' },
              totalAudience: 9000, isFavorite: false }],
            matchBrief: { source: 'filters', market: 'Nashville', category: 'Food & Drink', kind: 'paid', budget: 250, label: 'Food & Drink in Nashville' } };
          sigAiCardsAttach(turn, reply);
          return turn.cardActs[0].invite();
        }""")
        page.wait_for_timeout(700)
        flow2 = page.evaluate("() => state.sigFlow ? { brief: state.sigFlow.data.sourceBrief || null, creatorId: state.sigFlow.data.creatorId } : null")
        check("brief threading (AI cards): invite carries the card brief, label dropped",
              bool(flow2) and flow2["creatorId"] == "crnash2" and bool(flow2["brief"]) and flow2["brief"].get("budget") == 250 and "label" not in flow2["brief"], flow2)
        page.evaluate("""async () => {
          const d = state.sigFlow.data;
          d.kind = 'comp'; d.title = 'QA AI-card visit'; d.comped = 'Brunch for two'; d.cap = 60;
          await sigB1Commit();
          return true;
        }""")
        page.wait_for_timeout(900)
        rows2 = [o for o in offers_for("crnash2")]
        ai_offer = rows2[-1] if rows2 else {}
        check("brief threading (AI cards): the committed offer persists sourceBrief",
              "sourceBrief" in ai_offer and ai_offer["sourceBrief"].get("budget") == 250, ai_offer.get("sourceBrief"))
        # Control: no brief in scope -> no field, never inferred.
        page.evaluate("sigB1Start({ creatorId: 'crnash2', creatorName: 'Nash Eats Two', creatorRate: 300, creatorTier: 'Locals' })")
        page.wait_for_timeout(400)
        flow3 = page.evaluate("() => state.sigFlow ? (state.sigFlow.data.sourceBrief || null) : 'noflow'")
        check("brief threading control: a brief-less start carries no sourceBrief", flow3 is None, flow3)
        page.evaluate("""async () => {
          const d = state.sigFlow.data;
          d.kind = 'comp'; d.title = 'QA unbriefed visit'; d.comped = 'Coffee for two'; d.cap = 40;
          await sigB1Commit();
          return true;
        }""")
        page.wait_for_timeout(900)
        rows3 = offers_for("crnash2")
        plain_offer = rows3[-1] if rows3 else {}
        check("brief threading control: the committed offer has NO sourceBrief field",
              "sourceBrief" not in plain_offer and plain_offer.get("title") == "QA unbriefed visit", list(plain_offer.keys()))
        page.screenshot(path=f"{OUT}/06-brief-threading-desktop.png")
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()

print(json.dumps(R, indent=1))
print("qa-data145:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILURE(S): {FAILS}")
sys.exit(0 if not FAILS else 1)
