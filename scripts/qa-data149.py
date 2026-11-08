#!/usr/bin/env python3
"""Build -149 rendered QA (Phase 3 readiness): the Admin Data
view's export panel — the training_pairs dataset row with its
JSONL link and the plain-language training volume paragraph
(real fixture counts), at desktop 1440 and phone 390. Every
<img> asserted loaded, no horizontal overflow at either width.
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/data149-qa-2026-11-08")
os.makedirs(OUT, exist_ok=True)
PORT = 9101
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-data149-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const now = new Date().toISOString();
const today = now.slice(0, 10);
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const creator = (id, email, name, handle) => putUser({
  id, role: "creator", email, name, passwordSalt: salt, passwordHash: hash, status: "approved",
  market: "Nashville", city: "Nashville", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: now, tester: false,
  creator: { handle, primaryPlatform: "instagram", followerCount: 9000, totalAudience: 9000,
    audienceStack: { instagram: 9000 }, categories: ["Food & Drink"], localAudiencePct: 80,
    tierBand: "Locals", paidRate: 150, profileComplete: true, publicPage: true, hasPhoto: true, bio: name + " — local creator." },
});
creator("crA", "a@qa.dev", "Alpha Ann", "alphann");
creator("crB", "b@qa.dev", "Bravo Bob", "bravobob");
creator("crC", "c@qa.dev", "Charlie Cam", "charliecam");
putUser({ id: "bizmain", role: "business", email: "biz@qa.dev", name: "Main Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: now, tester: false, businessOnboarded: true,
  business: { businessName: "Main Kitchen", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", hasPhoto: true, about: "Wood-fired kitchen." } });
data["offer:camp1"] = { id: "camp1", businessId: "bizmain", businessName: "Main Kitchen", market: "Nashville", category: "Restaurant", kind: "paid", cashRate: 200, title: "Campaign One", status: "open", createdAt: "2026-11-05T00:00:00.000Z", updatedAt: "2026-11-05T00:00:00.000Z" };
data["application:appB"] = { id: "appB", offerId: "camp1", creatorId: "crB", businessId: "bizmain", status: "applied", createdAt: now };
data["booking:bkA"] = { id: "bkA", offerId: "camp1", businessId: "bizmain", creatorId: "crA", market: "Nashville", status: "completed", createdAt: "2026-11-06T00:00:00.000Z", redeemedAt: "2026-11-06T00:00:00.000Z" };
data["post:pA"] = { id: "pA", bookingId: "bkA", creatorId: "crA", url: "https://instagram.com/p/a", submittedAt: "2026-11-06T12:00:00.000Z", onTime: true };
const parts = (over) => Object.assign({ localPct: 80, category: 100, categorySignal: "direct", categoryLabel: "Food & Drink", budget: 100, budgetSignal: "fits", reliability: 70, reliabilityBasis: "neutral", deliveries: 0, onTimePct: null, momentum: 40, trackBonus: 0, trackReach: 0, trackPosts: 0, trackRedemptions: 0 }, over || {});
data[`event:${today}:qa-imp1`] = { id: "qa-imp1", ts: now, type: "match_impression", actorId: "bizmain", actorRole: "business", subjectId: "camp1", market: "Nashville",
  data: { via: "matches", brief: { source: "campaign", campaignId: "camp1", market: "Nashville", category: "Restaurant", kind: "paid", budget: 200 },
    shown: [ { creatorId: "crA", score: 88, parts: parts() }, { creatorId: "crB", score: 72, parts: parts({ localPct: 66 }) }, { creatorId: "crC", score: 65, parts: parts({ localPct: 40 }) } ] } };
data["config:markets"] = { flags: { "Nashville": true } };
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

try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

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

        def open_data_view(page):
            page.evaluate("go('dashboard','Stats')")
            page.wait_for_function("() => { const h = document.getElementById('ast-suggest'); return h && h.textContent.includes('Suggestions'); }", timeout=30000)
            page.evaluate("astSetView('data')")
            page.wait_for_function("() => { const h = document.getElementById('ast-data'); return h && h.textContent.includes('Export the raw data'); }", timeout=30000)
            page.wait_for_timeout(600)

        def export_facts(page):
            return page.evaluate("""() => {
              const host = document.getElementById('ast-data');
              const txt = host.textContent.replace(/\\s+/g, ' ');
              const tpRow = [...host.querySelectorAll('.kv')].find((r) => r.textContent.includes('training_pairs'));
              const jsonl = tpRow ? tpRow.querySelector('a[href*="format=jsonl"]') : null;
              return { txt,
                       hasTrainingPara: txt.includes('Match training pairs') && txt.includes('learned ranker'),
                       counts: txt.includes('holds 3 rows') && txt.includes('2 of them picks'),
                       tpRow: tpRow ? tpRow.textContent.replace(/\\s+/g, ' ') : '',
                       jsonlHref: jsonl ? jsonl.getAttribute('href') : null };
            }""")

        # Desktop
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "admin@qa.dev")
        page = boot_page(ctx)
        open_data_view(page)
        ef = export_facts(page)
        check("desktop: training volume paragraph renders with the fixture counts (3 rows, 2 picks)", ef["hasTrainingPara"] and ef["counts"], ef["txt"][-500:])
        check("desktop: training_pairs row carries the JSONL link", ef["jsonlHref"] == "/api/admin/stats/data/export?dataset=training_pairs&format=jsonl", ef["tpRow"])
        f = page_facts(page)
        check("desktop: no horizontal overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        panel = page.locator("#ast-data .panel", has_text="Export the raw data")
        panel.scroll_into_view_if_needed()
        page.wait_for_timeout(400)
        panel.screenshot(path=f"{OUT}/01-data-export-desktop.png")
        ctx.close()

        # Phone width
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        login(ctx, "admin@qa.dev")
        page = boot_page(ctx)
        open_data_view(page)
        ef = export_facts(page)
        check("390: training volume paragraph renders with the fixture counts", ef["hasTrainingPara"] and ef["counts"], ef["txt"][-300:])
        check("390: training_pairs JSONL link present", ef["jsonlHref"] == "/api/admin/stats/data/export?dataset=training_pairs&format=jsonl", ef["tpRow"])
        f = page_facts(page)
        check("390: no horizontal overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        panel = page.locator("#ast-data .panel", has_text="Export the raw data")
        panel.scroll_into_view_if_needed()
        page.wait_for_timeout(400)
        panel.screenshot(path=f"{OUT}/02-data-export-390.png")
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=10)
    except Exception:
        server.kill()

print("FAILS:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
