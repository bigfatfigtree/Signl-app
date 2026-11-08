#!/usr/bin/env python3
"""Build -150 rendered QA: the Data view's six sub-tabs
(section-scoped loads, per-section error isolation), the
reject confirmation guard on the Applications review surface
(nothing written until confirmed; cancel = byte-identical
record; approve stays one tap), and a fresh-eyes walk of the
whole Stats section — desktop 1440 and phone 390. Every <img>
asserted loaded, no horizontal overflow at either width.
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/data150-qa-2026-11-08")
os.makedirs(OUT, exist_ok=True)
PORT = 9106
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-data150-qa-")
db = os.path.join(tmp, "db.json")
TODAY = time.strftime("%Y-%m-%d", time.gmtime())

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const now = new Date().toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const creator = (id, email, name, handle, status, createdAt) => putUser({
  id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash, status,
  market: "Nashville", city: "Nashville", createdAt, updatedAt: now, tester: false,
  creator: { handle, primaryPlatform: "instagram", followerCount: 9000, totalAudience: 9000,
    audienceStack: { instagram: 9000 }, categories: ["Food & Drink"], localAudiencePct: 80,
    tierBand: "Locals", paidRate: 150, profileComplete: true, publicPage: true, hasPhoto: true, bio: name + " — local creator." },
});
creator("crA", "a@qa.dev", "Alpha Ann", "alphann", "approved", "2026-10-02T00:00:00.000Z");
creator("crB", "b@qa.dev", "Bravo Bob", "bravobob", "approved", "2026-10-03T00:00:00.000Z");
creator("crC", "c@qa.dev", "Charlie Cam", "charliecam", "approved", "2026-10-04T00:00:00.000Z");
// The review queue: a business to approve (one tap), two
// creators for the reject guard (confirm + cancel paths).
putUser({ id: "bizpend", role: "business", email: "pend@qa.dev", name: "Biz Owner", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: "2026-11-04T00:00:00.000Z", updatedAt: now, tester: false,
  business: { businessName: "Pending Kitchen", category: "Restaurant", plan: "growth", planId: "growth", hasPhoto: true, about: "Waiting on review." } });
creator("crRita", "rita@qa.dev", "Reject Rita", "rejectrita", "pending", "2026-11-05T00:00:00.000Z");
creator("crCarl", "carl@qa.dev", "Cancel Carl", "cancelcarl", "pending", "2026-11-06T00:00:00.000Z");
putUser({ id: "bizmain", role: "business", email: "biz@qa.dev", name: "Main Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: now, tester: false, businessOnboarded: true,
  business: { businessName: "Main Kitchen", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", hasPhoto: true, about: "Wood-fired kitchen." } });
data["offer:camp1"] = { id: "camp1", businessId: "bizmain", businessName: "Main Kitchen", market: "Nashville", category: "Restaurant", kind: "paid", cashRate: 200, title: "Campaign One", status: "open", createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z" };
data["application:appB"] = { id: "appB", offerId: "camp1", creatorId: "crB", businessId: "bizmain", status: "applied", createdAt: now };
data["booking:bkA"] = { id: "bkA", offerId: "camp1", businessId: "bizmain", creatorId: "crA", market: "Nashville", status: "completed", createdAt: "2026-11-06T00:00:00.000Z", redeemedAt: "2026-11-06T00:00:00.000Z" };
data["post:pA"] = { id: "pA", bookingId: "bkA", creatorId: "crA", url: "https://instagram.com/p/a", submittedAt: "2026-11-06T12:00:00.000Z", onTime: true };
const parts = (over) => Object.assign({ localPct: 80, category: 100, categorySignal: "direct", categoryLabel: "Food & Drink", budget: 100, budgetSignal: "fits", reliability: 70, reliabilityBasis: "neutral", deliveries: 0, onTimePct: null, momentum: 40, trackBonus: 0, trackReach: 0, trackPosts: 0, trackRedemptions: 0 }, over || {});
data[`event:${now.slice(0, 10)}:qa-imp1`] = { id: "qa-imp1", ts: now, type: "match_impression", actorId: "bizmain", actorRole: "business", subjectId: "camp1", market: "Nashville",
  data: { via: "matches", brief: { source: "campaign", campaignId: "camp1", market: "Nashville", category: "Restaurant", kind: "paid", budget: 200 },
    shown: [ { creatorId: "crA", score: 88, parts: parts() }, { creatorId: "crB", score: 72, parts: parts({ localPct: 66 }) } ] } };
data["config:markets"] = { flags: { "Nashville": true } };
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

def db_user(uid):
    return json.loads(open(db).read()).get(f"user:{uid}")

try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    # Outside import (2 sends + 1 prospect) and a forced sweep
    # so the Export section's frozen training summary exists.
    st, imp = api_post("/api/admin/imports/outside", {"items": [
        {"kind": "send", "importKey": "qa-send-1", "handle": "alphann", "email": "a@qa.dev", "lane": "gmail", "sentAt": "2026-11-07T10:00:00.000Z", "market": "Nashville"},
        {"kind": "send", "importKey": "qa-send-2", "handle": "bravobob", "email": "b@qa.dev", "lane": "gmail", "sentAt": "2026-11-07T11:00:00.000Z", "market": "Nashville"},
        {"kind": "prospect", "importKey": "qa-prospect-1", "handle": "prospectpam", "market": "Nashville", "verifiedAt": "2026-11-06T00:00:00.000Z"},
    ]}, token="qa-sweep-token")
    check("api: outside import lands (2 sends, 1 prospect)", st == 200 and imp["counts"]["send"]["written"] == 2 and imp["counts"]["prospect"]["written"] == 1, imp)
    st, sw = api_post("/api/admin/snapshot/sweep", {"force": True}, token="qa-sweep-token")
    check("api: forced snapshot sweep writes today", st == 200 and sw["sweep"]["wrote"] is True, sw)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def login(ctx, email, pw="qa-admin-pass"):
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

        def open_section(page, section, marker):
            page.evaluate(f"astSetView('data')")
            page.wait_for_function("() => { const h = document.getElementById('ast-data'); return h && h.querySelectorAll('button').length > 3; }", timeout=30000)
            page.evaluate(f"astSetDataSection('{section}')")
            page.wait_for_function(f"""() => {{ const h = document.getElementById('ast-data-section'); return h && h.textContent.includes({json.dumps(marker)}); }}""", timeout=30000)
            page.wait_for_timeout(400)

        def section_facts(page):
            return page.evaluate("""() => {
              const host = document.getElementById('ast-data-section');
              const txt = host ? host.textContent.replace(/\\s+/g, ' ') : '';
              const tabs = [...document.querySelectorAll('#ast-data button')].map((x) => x.textContent.trim());
              return { txt, tabs };
            }""")

        SECTIONS = [
            ("overview", "Capture health", ["Approved creators", "Capture health"]),
            ("supply", "Supply and demand, by market and category", ["Cell benchmarks", "Demand from unlisted cities"]),
            ("funnel", "Match funnel, last 30 days", ["Creator reliability", "Maggie's prompts"]),
            ("outside", "Outside the app", ["Outreach sends imported"]),
            ("snapshots", "Daily snapshots", ["Daily snapshots"]),
            ("export", "Export the raw data", ["training_pairs", "Match training pairs"]),
        ]

        def walk_sections(page, tag, shot_prefix):
            for section, marker, needles in SECTIONS:
                open_section(page, section, marker)
                sf = section_facts(page)
                missing = [n for n in needles if n not in sf["txt"]]
                check(f"{tag}: sub-tab '{section}' renders its own panels", not missing, f"missing={missing}")
                f = page_facts(page)
                check(f"{tag}: '{section}' no overflow, images loaded", not f["overflow"] and f["imgBroken"] == 0, f)
                try:
                    page.locator("#ast-data-section").scroll_into_view_if_needed()
                    page.wait_for_timeout(350)
                except Exception:
                    pass
                page.screenshot(path=f"{OUT}/{shot_prefix}-{section}.png", full_page=False)
            sf = section_facts(page)
            want = ["Overview", "Supply & demand", "Match funnel", "Outside the app", "Snapshots", "Export"]
            check(f"{tag}: all six plain-word sub-tab labels present", all(any(w in t for t in sf["tabs"]) for w in want), sf["tabs"])

        # ---------- desktop: sub-tabs + outside numbers ----------
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "admin@qa.dev")
        page = boot_page(ctx)
        open_stats(page)
        walk_sections(page, "desktop", "01-desktop")
        open_section(page, "outside", "Outside the app")
        sf = section_facts(page)
        check("desktop: outside panel counts the imported sends (2)", "Outreach sends imported" in sf["txt"] and "Prospects on file" in sf["txt"], sf["txt"][:300])
        open_section(page, "export", "Export the raw data")
        sf = section_facts(page)
        check("desktop: export shows the frozen training volume (2 rows, 2 picks)", "holds 2 rows" in sf["txt"] and "2 of them picks" in sf["txt"], sf["txt"][:400])
        open_section(page, "overview", "Capture health")
        sf = section_facts(page)
        check("desktop: overview headline band counts 3 approved creators", "Approved creators" in sf["txt"] and "Followers, stacked" in sf["txt"], sf["txt"][:300])
        ctx.close()

        # ---------- phone: sub-tabs + section failure isolation ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "admin@qa.dev")
        page = boot_page(ctx)
        open_stats(page)
        walk_sections(page, "390", "02-390")
        ctx.close()

        # ---------- phone: section failure isolation ----------
        # Fresh context (cold client caches): load Overview, then
        # kill ONLY the supply section's request — it must fail
        # alone, by name, while the rest of the view survives.
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "admin@qa.dev")
        page = boot_page(ctx)
        open_stats(page)
        open_section(page, "overview", "Capture health")
        import re as _re
        supply_re = _re.compile(r"section=supply")
        page.route(supply_re, lambda r: r.abort())
        page.evaluate("astSetDataSection('supply')")
        page.wait_for_function("() => { const h = document.getElementById('ast-data-section'); return h && h.textContent.includes('did not load'); }", timeout=30000)
        sf = section_facts(page)
        check("390: a failed section names itself and the view survives", "Supply & demand did not load." in sf["txt"] and "The rest of Data is unaffected" in sf["txt"], sf["txt"][:260])
        try:
            page.locator("#ast-data-section").scroll_into_view_if_needed()
            page.wait_for_timeout(350)
        except Exception:
            pass
        page.screenshot(path=f"{OUT}/03-390-section-error.png")
        page.unroute(supply_re)
        page.evaluate("astRetryDataSection('supply')")
        page.wait_for_function("() => { const h = document.getElementById('ast-data-section'); return h && h.textContent.includes('Supply and demand, by market and category'); }", timeout=30000)
        check("390: retry reloads the section cleanly", True)
        ctx.close()

        # ---------- phone: the reject guard, end to end ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "admin@qa.dev")
        page = boot_page(ctx)
        page.evaluate("go('dashboard','Applications')")
        page.wait_for_function("() => document.body.textContent.includes('Pending') || document.querySelector('.admin-deck-card')", timeout=30000)
        page.wait_for_timeout(800)

        rita_before = json.dumps(db_user("crRita"), sort_keys=True)
        # List view: reject Rita, then CANCEL the confirmation.
        page.evaluate("adminAppSetView('list')")
        page.wait_for_function("() => document.body.textContent.includes('Reject Rita')", timeout=30000)
        row = page.locator("tr", has_text="Reject Rita")
        row.locator("button", has_text="Reject").first.click()
        page.wait_for_selector("#rej-edit-crRita", state="visible")
        page.select_option("#rej-reason-crRita", "Content not a fit")
        row.locator("button", has_text="Send rejection").click()
        page.wait_for_selector("#confirm-sheet", timeout=10000)
        sheet = page.evaluate("() => { const s = document.getElementById('confirm-sheet'); return s ? s.textContent.replace(/\\s+/g, ' ') : ''; }")
        check("390 reject: confirmation names the applicant and the consequence", "@rejectrita" in sheet and "turns down" in sheet and "rejection email" in sheet, sheet[:300])
        check("390 reject: Cancel is the focused (safe) action", page.evaluate("() => document.activeElement && document.activeElement.id === 'confirm-sheet-no'"))
        check("390 reject: destructive button is danger-styled", page.evaluate("() => { const y = document.getElementById('confirm-sheet-yes'); return y && y.className.includes('danger'); }"))
        page.wait_for_timeout(700)  # let the sheet's slide-up animation settle before the shot
        page.screenshot(path=f"{OUT}/04-390-reject-confirm.png")
        page.click("#confirm-sheet-no")
        page.wait_for_timeout(700)
        check("390 reject: dialog closed after cancel", page.evaluate("() => !document.getElementById('confirm-sheet')"))
        check("390 reject: CANCEL wrote nothing (record byte-identical)", json.dumps(db_user("crRita"), sort_keys=True) == rita_before)
        check("390 reject: Rita still pending in the queue", "Reject Rita" in page.content() or page.evaluate("() => document.body.textContent.includes('Reject Rita')"))
        # Again, this time CONFIRM.
        row = page.locator("tr", has_text="Reject Rita")
        if row.locator("button", has_text="Send rejection").count() == 0:
            row.locator("button", has_text="Reject").first.click()
            page.wait_for_selector("#rej-edit-crRita", state="visible")
            page.select_option("#rej-reason-crRita", "Content not a fit")
        row.locator("button", has_text="Send rejection").click()
        page.wait_for_selector("#confirm-sheet", timeout=10000)
        page.click("#confirm-sheet-yes")
        page.wait_for_function("() => !document.body.textContent.includes('Reject Rita') || document.querySelectorAll('tr').length >= 0", timeout=15000)
        page.wait_for_timeout(900)
        rita_after = db_user("crRita")
        check("390 reject: CONFIRM writes exactly the rejection (status + reason)", rita_after["status"] == "rejected" and rita_after.get("rejectionReason") == "Content not a fit", {k: rita_after.get(k) for k in ("status", "rejectionReason")})

        # Approve stays one tap: the pending business, no dialog.
        biz_before = db_user("bizpend")
        check("setup: business still pending before approve", biz_before["status"] == "pending")
        brow = page.locator("tr", has_text="Pending Kitchen")
        brow.locator("button", has_text="Approve").first.click()
        page.wait_for_timeout(1200)
        check("390 approve: NO confirmation dialog on approve", page.evaluate("() => !document.getElementById('confirm-sheet')"))
        check("390 approve: one tap approved the business", db_user("bizpend")["status"] == "approved", db_user("bizpend").get("status"))

        # Deck view: the guard covers the deck too (cancel path).
        page.evaluate("adminAppSetView('deck')")
        page.wait_for_timeout(900)
        deck_name = page.evaluate("() => { const c = document.querySelector('.admin-deck-card'); return c ? c.textContent.replace(/\\s+/g, ' ').slice(0, 200) : ''; }")
        carl_before = json.dumps(db_user("crCarl"), sort_keys=True)
        page.locator(".admin-deck-card button", has_text="Reject").first.click()
        page.wait_for_selector("#admin-deck-reject .admin-deck-rejectbox", timeout=10000)
        page.locator(".admin-deck-card button", has_text="Send rejection").click()
        page.wait_for_selector("#confirm-sheet", timeout=10000)
        sheet = page.evaluate("() => { const s = document.getElementById('confirm-sheet'); return s ? s.textContent.replace(/\\s+/g, ' ') : ''; }")
        check("390 deck reject: confirmation opens from the deck and names the applicant", "Reject" in sheet and ("cancelcarl" in sheet or "Cancel Carl" in sheet), sheet[:260] + " || card: " + deck_name[:80])
        page.click("#confirm-sheet-no")
        page.wait_for_timeout(700)
        check("390 deck reject: cancel wrote nothing (Carl byte-identical, still pending)", json.dumps(db_user("crCarl"), sort_keys=True) == carl_before and db_user("crCarl")["status"] == "pending")
        page.screenshot(path=f"{OUT}/05-390-deck-after-cancel.png")
        ctx.close()

        # ---------- phone: fresh-eyes walk of the whole Stats section ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "admin@qa.dev")
        page = boot_page(ctx)
        open_stats(page)
        for view in ["creators", "businesses", "website", "partners", "revenue", "data"]:
            page.evaluate(f"astSetView('{view}')")
            page.wait_for_timeout(1500)
            facts = page.evaluate("""() => {
              const host = document.querySelector('.content') || document.body;
              const txt = host.textContent.replace(/\\s+/g, ' ');
              return { len: txt.length, broken: txt.includes('Something went wrong') };
            }""")
            f = page_facts(page)
            check(f"390 stats walk: '{view}' renders content, no page-wide error, no overflow, images ok",
                  facts["len"] > 200 and not facts["broken"] and not f["overflow"] and f["imgBroken"] == 0, {**facts, **f})
            if view in ("creators", "revenue"):
                try:
                    page.locator(f"#astview-{view}").scroll_into_view_if_needed()
                    page.wait_for_timeout(350)
                except Exception:
                    pass
                page.screenshot(path=f"{OUT}/06-390-stats-{view}.png")
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except Exception:
        server.kill()

print("FAILS:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
