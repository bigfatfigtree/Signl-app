#!/usr/bin/env python3
"""Build -99 Playwright QA: the ONE setup checklist on business
Home and the moved Square connect.

Desktop + 390px, full chromium (the xmedium-qa chain). Seeded
businesses: an active business in a mixed state (baseline and
PIN done, the rest not), an all-done business (the surface
retires), and a founding business (checklist on founding Home).
Square is "configured" by env only, so the checklist item shows
the real Connect Square anchor; the full OAuth flow itself is
proven against the stub in verify-build99.mjs, so QA asserts
the anchor's href instead of leaving the app for Square's site.
"""
import os, sys, json, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-audit-2026-11-01/fix-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 8987
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b99-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const biz = (id, email, business) => putUser({ id, role: "business", email, name: "Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 30 * DAY), business });
// Mixed state: baseline + PIN done; page has about but no logo.
biz("bizmixed", "mixed@b99qa.dev", { businessName: "Mixed Grill", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Wood-fired everything, in East Nashville.", baseline: { dayLabel: "Saturday", count: 40 } });
data["staffpin:bizmixed"] = { pin: "2468", setAt: iso(now0 - DAY) };
// All done.
biz("bizdone", "done@b99qa.dev", { businessName: "Done Deli", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "A finished page.", baseline: { dayLabel: "Saturday", count: 40 }, standingAvailability: { days: ["Saturday"], hours: "10 to 10", appointments: "" }, assetPacket: { logoUrl: "https://example.com/logo.png", links: [], talkingPoints: "", handle: "", hashtags: [] } });
data["staffpin:bizdone"] = { pin: "2468", setAt: iso(now0 - DAY) };
data["proofkit:bizdone"] = { counterCardPrintedAt: iso(now0 - DAY), testRedeemedAt: iso(now0 - DAY) };
data["favorite:bizdone:crqa"] = { creatorId: "crqa", createdAt: iso(now0 - DAY) };
data["offer:off-qa"] = { id: "off-qa", businessId: "bizdone", businessName: "Done Deli", market: "Nashville", category: "Restaurant", title: "Done draft", status: "draft", lane: "open", createdAt: iso(now0 - DAY), updatedAt: iso(now0 - DAY) };
data["sqconn:bizdone"] = { businessId: "bizdone", status: "connected", env: "sandbox", businessName: "Done Deli", connectedAt: iso(now0 - DAY), locations: [{ id: "LOC-1", name: "Downtown" }], selectedLocationIds: ["LOC-1"], catalog: {}, accessTokenEnc: "x", refreshTokenEnc: "x", merchantId: "MERCH-1" };
// Founding, nothing done.
biz("bizfound", "found@b99qa.dev", { businessName: "Founding Fork", category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "founding" });
putUser({ id: "crqa", role: "creator", email: "crqa@b99qa.dev", name: "Casey", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 30 * DAY), creator: { handle: "crqa", followerCount: 3000, totalAudience: 3000, audienceStack: { instagram: 3000 }, categories: ["Food & Drink"], localAudiencePct: 70, tierBand: "Locals", profileComplete: true } });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE,
           ADMIN_EMAIL="admin@b99.dev", ADMIN_PASSWORD="b99-qa-admin-123",
           SQUARE_APP_ID="sq-qa-app-id", SQUARE_APP_SECRET="sq-qa-app-secret", SQUARE_ENV="sandbox")
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
R = {}
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium")

        def login(ctx, email):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": "qa-pass-1234"})
            return r.status

        # ---------- desktop: mixed checklist on active Home ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["login_mixed"] = login(ctx, "mixed@b99qa.dev")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2500)
        R["mixed_checklist"] = pg.evaluate("""() => {
          const el = document.getElementById('setup-checklist');
          if (!el) return null;
          const rows = [...el.querySelectorAll('div')].filter(d => d.querySelector(':scope > div .badge, :scope > .badge'));
          return { text: el.innerText.slice(0, 900), cards: document.querySelectorAll('#setup-checklist').length,
                   proofKitCards: document.querySelectorAll('#proof-kit').length,
                   startHere: document.querySelectorAll('.start-here').length };
        }""")
        R["connect_anchor"] = pg.evaluate("""() => {
          const a = document.querySelector('#setup-checklist a[href="/api/me/square/start"]');
          return a ? { text: a.innerText, href: a.getAttribute('href') } : null;
        }""")
        el = pg.locator("#setup-checklist")
        el.scroll_into_view_if_needed(); pg.wait_for_timeout(400)
        el.screenshot(path=f"{OUT}/b99-checklist-mixed-desktop.png")
        pg.screenshot(path=f"{OUT}/b99-home-mixed-desktop.png", full_page=False)
        R["mixed_overflow"] = pg.evaluate("() => document.scrollingElement.scrollWidth")

        # ---------- desktop: Results points at the checklist ----------
        pg.evaluate("() => go('dashboard','Analytics')"); pg.wait_for_timeout(2500)
        R["results_register"] = pg.evaluate("""() => {
          const host = document.getElementById('biz-receipt');
          if (!host) return null;
          const det = host.querySelector('details'); if (det) det.open = true;
          const sq = [...host.querySelectorAll('a')].map(a => a.innerText).filter(t => /square/i.test(t));
          return { connectAnchors: sq, hasPointer: host.innerText.includes('Open the setup checklist on Home'),
                   hasNotConnected: host.innerText.includes('Register not connected') };
        }""")
        pg.wait_for_timeout(400)
        det = pg.locator("#biz-receipt details")
        if det.count():
            det.first.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
            det.first.screenshot(path=f"{OUT}/b99-results-pointer-desktop.png")
        ctx.close()

        # ---------- desktop: all done, the surface retires ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["login_done"] = login(ctx, "done@b99qa.dev")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2500)
        R["done_checklist"] = pg.evaluate("() => document.querySelectorAll('#setup-checklist').length")
        pg.screenshot(path=f"{OUT}/b99-home-retired-desktop.png", full_page=False)
        ctx.close()

        # ---------- desktop: founding Home carries the checklist ----------
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        R["login_found"] = login(ctx, "found@b99qa.dev")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2800)
        R["found_checklist"] = pg.evaluate("""() => {
          const el = document.getElementById('setup-checklist');
          return el ? el.innerText.slice(0, 200) : null;
        }""")
        el = pg.locator("#setup-checklist")
        if el.count():
            el.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
            el.screenshot(path=f"{OUT}/b99-checklist-founding-desktop.png")
        ctx.close()

        # ---------- mobile 390px: the tap path ----------
        ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=3)
        pg = ctx.new_page()
        R["login_mixed_m"] = login(ctx, "mixed@b99qa.dev")
        pg.goto(BASE + "/", wait_until="networkidle"); pg.wait_for_timeout(2500)
        el = pg.locator("#setup-checklist")
        el.scroll_into_view_if_needed(); pg.wait_for_timeout(400)
        el.screenshot(path=f"{OUT}/b99-checklist-mixed-mobile.png")
        a = pg.locator('#setup-checklist a[href="/api/me/square/start"]')
        R["mobile_connect_visible"] = a.count() == 1 and a.first.is_visible()
        a.first.scroll_into_view_if_needed(); pg.wait_for_timeout(300)
        pg.screenshot(path=f"{OUT}/b99-mobile-connect-square.png", full_page=False)
        R["mobile_overflow"] = pg.evaluate("() => document.scrollingElement.scrollWidth")
        ctx.close()

        b.close()
finally:
    server.kill()

print(json.dumps(R, indent=1)[:4000])
assert R.get("connect_anchor") and R["connect_anchor"]["text"] == "Connect Square", "Connect Square anchor missing/mislabeled"
assert R["mixed_checklist"] and R["mixed_checklist"]["cards"] == 1 and R["mixed_checklist"]["proofKitCards"] == 0 and R["mixed_checklist"]["startHere"] == 0
assert R["results_register"] and R["results_register"]["hasPointer"] and not any("Connect Square" == t for t in R["results_register"]["connectAnchors"])
assert R["done_checklist"] == 0, "retired state still renders the checklist"
assert R["found_checklist"] and "Get the most from SIGNL" in R["found_checklist"]
assert R["mobile_connect_visible"], "Connect Square not visible at 390px"
assert R["mobile_overflow"] <= 390 and R["mixed_overflow"] <= 1280
print("QA-B99 OK")
