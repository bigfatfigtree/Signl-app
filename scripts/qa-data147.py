#!/usr/bin/env python3
"""Build -147 rendered QA (Outside Joins: Phase 2 of the data
program).

Desktop 1440 + phone 390, fixture outside data seeded straight
into the store (the import path itself is proven by
scripts/verify-outside-joins.mjs):
- Admin Stats -> Data view gains the "Outside the app" panel:
  outreach sends imported (with the capturing-since date and
  the Gmail/DM lane split), the prospect universe by market
  (verified / contacted / signed up), form submissions landed,
  reply outcomes, and MDS bounce classes — every number
  asserted as rendered text, no empty boxes, and the panel
  states plainly that the Gmail lane has no open/click
  tracking.
- The imported city request (Franklin) shows in the typed-city
  backlog panel of the same view.
Chromium runs through the local relay with loopback bypassed;
every <img> on the surface is asserted loaded.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/data147-qa-2026-11-08")
os.makedirs(OUT, exist_ok=True)
PORT = 9101
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-data147-qa-")
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
putUser({ id: "crnash1", role: "creator", email: "nash1@qa.dev", name: "Nash Food One", passwordSalt: salt, passwordHash: hash, status: "approved",
  market: "Nashville", city: "Nashville", createdAt: daysAgo(30), updatedAt: now, tester: false,
  creator: { handle: "nashfoodone", primaryPlatform: "instagram", followerCount: 9000, totalAudience: 9000,
    audienceStack: { instagram: 9000 }, categories: ["Food & Drink"], localAudiencePct: 80,
    tierBand: "Locals", paidRate: 150, profileComplete: true, publicPage: true, hasPhoto: true, bio: "Nash — local creator." } });
putUser({ id: "ben", role: "business", email: "ben@qa.dev", name: "Ben Baker", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: daysAgo(30), updatedAt: now, tester: false, businessOnboarded: true,
  business: { businessName: "Salt & Stone Kitchen", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", hasPhoto: true, about: "Wood-fired kitchen." } });
// ---- outside data, in the exact shapes Build -147 writes ----
const op = (handle, extra) => { data[`outprospect:${handle}`] = Object.assign({ handle, markets: [], verifiedMarkets: [], sources: ["roster", "sent_map"], createdAt: "2026-11-07T00:00:00.000Z", updatedAt: "2026-11-07T00:00:00.000Z" }, extra); };
op("austprospect1", { name: "Austin One", email: "ap1@qa.dev", market: "Austin", markets: ["Austin"], verifiedMarkets: ["Austin"], category: "food", followers: 12000, verifiedAt: "2026-11-07T00:00:00.000Z", contacted: true, firstContactAt: "2026-11-04T15:00:00.000Z", lastContactAt: "2026-11-04T15:00:00.000Z", contactLane: "gmail", joinedUserId: "crnash1", joinedOn: "handle", joinedAt: "2026-11-05T00:00:00.000Z" });
op("austprospect2", { name: "Austin Two", market: "Austin", markets: ["Austin"], verifiedMarkets: ["Austin"], category: "fitness", followers: 8000, verifiedAt: "2026-11-07T00:00:00.000Z", replyOutcome: "interested", replyAt: "2026-11-06T09:00:00.000Z" });
op("dualmarket", { name: "Dual Market", market: "Raleigh", markets: ["Raleigh", "Charlotte"], verifiedMarkets: ["Raleigh", "Charlotte"], category: "food", followers: 3000, verifiedAt: "2026-11-07T00:00:00.000Z" });
op("dmfriend", { name: "DM Friend", market: "London", markets: ["London"], sources: ["sent_map"], contacted: true, firstContactAt: "2026-11-05T15:00:00.000Z", lastContactAt: "2026-11-05T15:00:00.000Z", contactLane: "dm", bounceClass: "soft", bounceCode: "5.2.2", bounceCount: 1 });
data["impkey:send:gmail:m1"] = { at: now, eventId: "e1", lane: "gmail" };
data["impkey:send:gmail:m2"] = { at: now, eventId: "e2", lane: "gmail" };
data["impkey:send:dm:m3"] = { at: now, eventId: "e3", lane: "dm" };
data["impkey:bounce:mds:a"] = { at: now, eventId: "e4", bounceClass: "hard" };
data["impkey:bounce:mds:b"] = { at: now, eventId: "e5", bounceClass: "soft" };
data["impkey:reply:r1"] = { at: now, eventId: "e6", outcome: "interested" };
data["impkey:reply:r2"] = { at: now, eventId: "e7", outcome: "declined" };
data["impkey:form:gmail:f1"] = { at: now, eventId: "e8", formType: "city-request", recordId: "cr1" };
data["impkey:form:gmail:f2"] = { at: now, eventId: "e9", formType: "business-application", recordId: "ba1" };
data["cityrequest:cr1"] = { id: "cr1", city: "Franklin", region: "TN", handle: "franklinfoodie", email: null, createdAt: "2026-11-06T12:00:00.000Z", source: "netlify_form", sourceRef: "gmail:f1" };
data["bizapp:ba1"] = { id: "ba1", businessName: "Proof Tacos", category: "Restaurant", type: "Food truck", contactName: "Pat Proof", email: "pat@qa.dev", phone: "", city: "Franklin, TN", tierInterest: "Growth", source: "netlify-form", sourceRef: "gmail:f2", createdAt: "2026-11-06T12:05:00.000Z" };
data["event:2026-11-02:evsent"] = { id: "evsent", ts: "2026-11-02T15:00:00.000Z", type: "outreach_sent", actorId: null, actorRole: null, subjectId: "outprospect:austprospect1", market: "Austin", data: { source: "gmail_lane", email: "ap1@qa.dev", handle: "austprospect1", lane: "gmail", message_id: "m1" } };
data["event:2026-11-06:evform"] = { id: "evform", ts: "2026-11-06T12:00:00.000Z", type: "form_received", actorId: null, actorRole: null, subjectId: "cr1", market: null, data: { source: "netlify_form", formType: "city-request", city: "Franklin", recordId: "cr1", recordKind: "cityrequest" } };
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

try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def run_view(ctx, width_name, viewport, mobile=False):
            page = ctx.new_page()
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
            page.wait_for_timeout(900)
            page.evaluate("go('dashboard','Stats')")
            page.wait_for_function("() => { const h = document.getElementById('ast-suggest'); return h && h.textContent.includes('Suggestions'); }", timeout=30000)
            page.evaluate("astSetView('data')")
            page.evaluate("astSetDataSection('outside')")
            page.wait_for_function("() => { const h = document.getElementById('ast-data-section'); return h && h.textContent.includes('Outside the app'); }", timeout=30000)
            page.wait_for_timeout(700)
            txt = page.evaluate("() => document.getElementById('ast-data-section').textContent.replace(/\\s+/g, ' ')")
            facts = page.evaluate("""() => {
              const imgs = [...document.images];
              return { overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
                       imgTotal: imgs.length,
                       imgBroken: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).length };
            }""")
            return page, txt, facts

        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        r = ctx.request.post(BASE + "/api/auth/login", data={"email": "admin@qa.dev", "password": "qa-admin-pass"})
        assert r.status == 200, f"admin login -> {r.status}"
        page, txt, f = run_view(ctx, "desktop", None)
        check("outside panel: headline counts render (3 sends, 4 prospects, 1 signed up, 2 forms, 2 replies, 2 bounces)",
              all(s in txt for s in ["3", "Outreach sends imported", "4", "Prospects on file", "Prospects now signed up", "2", "Form submissions imported", "Replies on record", "Bounces on record"]), txt[:200])
        check("outside panel: send history carries its start date and the lane split (Gmail 2, DM 1)",
              "Send history imported from 2026-11-02" in txt and "Gmail 2" in txt and "DM 1" in txt, txt[txt.find("Send history"):txt.find("Send history") + 140] if "Send history" in txt else txt[:200])
        check("outside panel: honesty line — no open/click tracking is claimed for the Gmail lane",
              "no open or click tracking" in txt, "")
        check("outside panel: reply outcomes and bounce classes render with numbers",
              "Reply outcomes:" in txt and "interested 1" in txt and "declined 1" in txt and "Bounces:" in txt and "hard 1" in txt and "soft 1" in txt, txt[:240])
        check("outside panel: forms line (1 city request, 1 business application)",
              "Site forms:" in txt and "1 city request" in txt and "1 business application" in txt, "")
        check("outside panel: prospect universe by market (Austin 2v/1c/1j, Raleigh 1v, London 1c)",
              "Prospect universe by market" in txt and "Austin" in txt and "2 verified · 1 contacted · 1 signed up" in txt and "Raleigh" in txt and "London" in txt, txt[txt.find("Prospect universe"):txt.find("Prospect universe") + 200] if "Prospect universe" in txt else "")
        # Build -150: the backlog panel lives in the Supply &
        # demand sub-tab now; open it for the Franklin check.
        page.evaluate("astSetDataSection('supply')")
        page.wait_for_function("() => { const h = document.getElementById('ast-data-section'); return h && h.textContent.includes('Demand from unlisted cities'); }", timeout=30000)
        page.wait_for_timeout(300)
        supply_txt = page.evaluate("() => document.getElementById('ast-data-section').textContent.replace(/\\s+/g, ' ')")
        check("backlog: the imported Franklin city request shows in Demand from unlisted cities",
              "Franklin" in supply_txt and "franklinfoodie" in supply_txt, supply_txt[:200])
        check("desktop: no horizontal overflow, every image loaded", not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/01-outside-desktop.png", full_page=True)
        ctx.close()

        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=3)
        r = ctx.request.post(BASE + "/api/auth/login", data={"email": "admin@qa.dev", "password": "qa-admin-pass"})
        assert r.status == 200, f"admin login (mobile) -> {r.status}"
        page, txt, f = run_view(ctx, "390", None, mobile=True)
        check("390: outside panel renders with its numbers, no overflow, every image loaded",
              "Outside the app" in txt and "Outreach sends imported" in txt and "Prospect universe by market" in txt and not f["overflow"] and f["imgBroken"] == 0, f)
        page.screenshot(path=f"{OUT}/02-outside-390.png", full_page=True)
        ctx.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except Exception:
        server.kill()

print(json.dumps(R, indent=1))
print("qa-data147:", "ALL PASS" if not FAILS else f"{len(FAILS)} FAILURE(S): {FAILS}")
sys.exit(0 if not FAILS else 1)
