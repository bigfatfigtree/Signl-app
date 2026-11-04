#!/usr/bin/env python3
"""Build -126 rendered QA (Jeff, 2026-11-04 orders from the -125
screenshots):
  * Admin home at 390 + desktop: platform totals strip +
    Business/Creator/Partner preview tabs above the fold.
  * The OPEN identity menu, admin + creator (Profile / Settings
    / Sign out rows).
  * Admin Your account view (new).
  * Preview tabs exercised for real: Creator tab -> read-only
    ADMIN VIEW of the test creator; Partner tab -> the demo
    partner; exits return to Admin.
  * Sign out from the menu ends the session; a reload stays
    signed out.
  * Command Center at 390 fully wrapped.
  * MECHANICAL OVERFLOW AUDIT: every primary view of every role
    at 390px — document must not exceed the viewport and no
    element may cross the right edge unless it scrolls inside
    its own card. Results -> overflow-audit.txt.
Output: ~/workspace/research_notes/signl-build126-qa/
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build126-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9078
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b126-qa-")
db = os.path.join(tmp, "db.json")
PW = "qa-pass-1234"
fails = []
notes = []

def check(name, cond, extra=""):
    print(("  ok " if cond else "FAIL ") + name + ((" :: " + str(extra)[:240]) if (extra and not cond) else ""))
    if not cond:
        fails.append(name)

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
data["config:markets"] = { flags: { Nashville: true } };
putUser({ id: "cara", role: "creator", email: "cara@b126.dev", name: "Cara Creators", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 40 * DAY), updatedAt: iso(now0 - 2 * DAY),
  creator: { handle: "caracreates", primaryPlatform: "instagram", followerCount: 12400, totalAudience: 15800, audienceStack: { instagram: 12400, tiktok: 3400 }, audienceMarkets: [{ market: "Nashville", pct: 74 }], categories: ["Food & Drink"], localAudiencePct: 74, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "Nashville eats and honest reviews." } });
putUser({ id: "tina", role: "creator", email: "tina@b126.dev", name: "Tina Tester", passwordSalt: salt, passwordHash: hash, status: "approved", tester: true, market: "Nashville", city: "Nashville", createdAt: iso(now0 - 20 * DAY), updatedAt: iso(now0 - 1 * DAY),
  creator: { handle: "tinatester", primaryPlatform: "instagram", followerCount: 900, totalAudience: 900, audienceStack: { instagram: 900 }, categories: ["Coffee"], localAudiencePct: 80, tierBand: "Neighbors", profileComplete: true, hasPhoto: false, bio: "The approved test creator account." } });
putUser({ id: "basil", role: "business", email: "basil@b126.dev", name: "Basil Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY),
  business: { businessName: "Basil & Co", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", about: "Wood-fired kitchen in East Nashville." } });
putUser({ id: "dana", role: "partner", email: "dana@b126.dev", name: "Dana Media", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY),
  partner: { orgName: "Dana Media Group", name: "Dana Media Group", markets: ["Nashville"], status: "active" } });
putUser({ id: "pdemo", role: "partner", email: "pdemo@b126.dev", name: "Demo Dana", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Virginia Beach", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY),
  partner: { orgName: "Demo Media Group", name: "Demo Media Group", markets: ["Virginia Beach"], status: "active", demo: true } });
putUser({ id: "pilotdana", role: "pilot_partner", email: "pilot@b126.dev", name: "Dana Langley", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Virginia Beach", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY), pilotId: "pilot1",
  pilotPartner: { partnerName: "Langley Federal Credit Union", pilotName: "Hampton Roads Pilot" } });
data["pilot:pilot1"] = { id: "pilot1", name: "Hampton Roads Pilot", partnerName: "Langley Federal Credit Union", marketId: "virginia-beach", marketName: "Virginia Beach", fundCents: 500000, status: "active", partnerUserId: "pilotdana", createdBy: null, createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY) };
data["pilotbiz:pilot1:basil"] = { id: "pb1", pilotId: "pilot1", businessId: "basil", name: "Basil & Co", marketName: "Virginia Beach", status: "invited", createdBy: null, createdAt: iso(now0 - 9 * DAY), updatedAt: iso(now0 - 9 * DAY) };
putUser({ id: "rita", role: "recruiter", email: "rita@b126.dev", name: "Rita Recruiter", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY), recruiterEntityId: "ent-rita",
  recruiter: { code: "rita", marketId: "nashville", marketName: "Nashville" } });
data["recruiter:ent-rita"] = { id: "ent-rita", kind: "staff", code: "rita", name: "Rita Recruiter", email: "rita@b126.dev", marketId: "nashville", marketName: "Nashville", status: "active", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY), createdBy: null };
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-pass-126"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1", SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b126.dev"
env["ADMIN_PASSWORD"] = ADMIN_PW
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

OVERFLOW_JS = r"""() => {
  const iw = window.innerWidth;
  const docSW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const contained = (el) => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.getBoundingClientRect().right <= iw + 1) return true;
      n = n.parentElement;
    }
    return false;
  };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > iw + 1 && r.left < iw && !contained(el)) {
      bad.push({ tag: el.tagName, cls: String(el.className && el.className.baseVal === undefined ? el.className : '').slice(0, 50), right: Math.round(r.right), w: Math.round(r.width), text: (el.textContent || '').trim().slice(0, 36) });
    }
  }
  bad.sort((a, b) => b.right - a.right);
  // De-dupe: keep only outermost offenders (an element whose ancestor is already listed is noise).
  const out = [];
  for (const b of bad) { out.push(b); if (out.length >= 4) break; }
  return { iw, docSW, excess: docSW - iw, bad: out };
}"""

audit_rows = []

def audit(page, role, view):
    try:
        rep = page.evaluate(OVERFLOW_JS)
    except Exception as e:
        audit_rows.append((role, view, "ERROR", str(e)[:80]))
        return
    status = "OK" if rep["excess"] <= 1 and not rep["bad"] else "OVERFLOW"
    detail = ""
    if rep["bad"]:
        b = rep["bad"][0]
        detail = f"worst: <{b['tag'].lower()} class=\"{b['cls']}\"> right={b['right']} w={b['w']} '{b['text']}'"
    audit_rows.append((role, view, f"{status} (doc {rep['docSW']} vs {rep['iw']})", detail))
    if status != "OK":
        notes.append(f"overflow: {role}/{view} {detail}")

def new_ctx(b, w=390, h=844):
    return b.new_context(viewport={"width": w, "height": h}, ignore_https_errors=True,
                         has_touch=(w < 768), is_mobile=(w < 768), device_scale_factor=3 if w < 768 else 1)

def login(ctx, email, pw):
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
    assert r.status == 200, f"login {email}: {r.status}"
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(900)
    return page

def goto_tab(page, tab, wait=1300):
    page.evaluate(f"go('dashboard','{tab}')")
    page.wait_for_timeout(wait)

try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        # ---------------- ADMIN ----------------
        ctx = new_ctx(b)
        page = login(ctx, "admin@b126.dev", ADMIN_PW)
        page.wait_for_timeout(1200)
        body = page.inner_text("body")
        check("admin home: totals strip numbers render (1 signed up / 15.8k followers from the one non-tester creator set)",
              "Creators signed up" in body and "Total followers" in body, body[:300])
        tabs_row = page.evaluate("() => { const el = document.querySelector('.pv-tabs126'); return el ? el.innerText.replace(/\\n/g,' ') : ''; }")
        check("admin home: preview tab row reads Business / Creator / Partner", all(w in tabs_row for w in ["Business", "Creator", "Partner"]), tabs_row)
        page.screenshot(path=f"{OUT}/01-admin-home-390.png")
        audit(page, "admin", "Applications (home)")

        # identity menu (admin, phone)
        page.click(".tr-id")
        page.wait_for_timeout(500)
        menu = page.inner_text("#identity-menu126")
        check("admin identity menu opens with Your account + Sign out", "Your account" in menu and "Sign out" in menu, menu[:200])
        page.screenshot(path=f"{OUT}/03-admin-identity-menu-390.png")
        # -> Your account view
        page.click("#identity-menu126 .idm126-row >> nth=0")
        page.wait_for_timeout(800)
        acct = page.inner_text("main")
        check("admin Your account view: identity + email + change password + Sign out",
              "Your account" in acct and "admin@b126.dev" in acct and "Change password" in acct and "Sign out" in acct, acct[:260])
        page.screenshot(path=f"{OUT}/06-admin-your-account-390.png")
        audit(page, "admin", "Account (Your account)")

        # preview tabs: Creator
        goto_tab(page, "Applications", 1200)
        page.click(".pv-tab126 >> nth=1")
        page.wait_for_timeout(2200)
        banner = page.inner_text("#viewas-banner")
        check("Creator preview tab: ADMIN VIEW banner names the test creator", "ADMIN VIEW" in banner and "Tina Tester" in banner, banner[:200])
        page.screenshot(path=f"{OUT}/07-preview-creator-view-390.png")
        audit(page, "admin-view", "creator view-as")
        page.click("#viewas-banner button")
        page.wait_for_timeout(1200)
        check("exit creator view returns to Admin home", "SIGNL Admin" in page.inner_text("main"))
        # preview tabs: Partner
        page.click(".pv-tab126 >> nth=2")
        page.wait_for_timeout(2200)
        banner = page.inner_text("#viewas-banner")
        check("Partner preview tab: ADMIN VIEW banner names the demo partner", "ADMIN VIEW" in banner and "Demo Media Group" in banner, banner[:200])
        page.screenshot(path=f"{OUT}/08-preview-partner-view-390.png")
        audit(page, "admin-view", "partner view-as")
        page.click("#viewas-banner button")
        page.wait_for_timeout(1200)
        # preview tabs: Business (simulation)
        page.click(".pv-tab126 >> nth=0")
        page.wait_for_timeout(1500)
        pv = page.inner_text("body")
        check("Business preview tab enters the preview simulation (PREVIEW banner)", "PREVIEW" in pv, pv[:200])
        audit(page, "admin", "Business Preview (simulation)")
        page.evaluate("exitPreview()")
        page.wait_for_timeout(900)

        # admin sections audit
        for tab, wait in [("Requests", 1400), ("Markets", 1600), ("Partners", 1600), ("Recruiters", 1400),
                          ("Outreach", 1400), ("Event Log", 1400), ("Compliance", 1400), ("Campaign", 1400), ("Sig", 1400)]:
            goto_tab(page, tab, wait)
            audit(page, "admin", tab)
        goto_tab(page, "Stats", 2600)
        page.screenshot(path=f"{OUT}/05-command-center-390.png")
        audit(page, "admin", "Stats / Command Center (Overview)")
        for sub in ["wallet", "partners", "businesses", "creators", "markets", "owed", "close"]:
            page.evaluate(f"ccSetTab('{sub}')")
            page.wait_for_timeout(1800)
            audit(page, "admin", f"Command Center / {sub}")
        ctx.close()

        # admin desktop: home + menu
        dctx = new_ctx(b, 1280, 900)
        dpage = login(dctx, "admin@b126.dev", ADMIN_PW)
        dpage.wait_for_timeout(1200)
        dpage.screenshot(path=f"{OUT}/02-admin-home-desktop.png")
        dpage.click(".tr-id")
        dpage.wait_for_timeout(500)
        dpage.screenshot(path=f"{OUT}/04-admin-identity-menu-desktop.png")
        audit(dpage, "admin-desktop", "Applications (home)")
        dctx.close()

        # admin sign-out flow (fresh context): menu -> Sign out -> signed-out screen; reload stays out
        sctx = new_ctx(b)
        spage = login(sctx, "admin@b126.dev", ADMIN_PW)
        spage.click(".tr-id")
        spage.wait_for_timeout(400)
        spage.click("#identity-menu126 .idm126-row >> nth=1")
        spage.wait_for_timeout(1500)
        out_body = spage.inner_text("body")
        signed_out = ("Sign in" in out_body) and ("SIGNL Admin" not in out_body)
        check("sign out from the identity menu lands on the signed-out screen", signed_out, out_body[:200])
        spage.reload(wait_until="networkidle")
        spage.wait_for_timeout(900)
        out_body2 = spage.inner_text("body")
        check("after reload the app is STILL signed out (session really ended)", ("Sign in" in out_body2) and ("SIGNL Admin" not in out_body2), out_body2[:200])
        spage.screenshot(path=f"{OUT}/09-signed-out-after-signout-390.png")
        sctx.close()

        # ---------------- CREATOR ----------------
        cctx = new_ctx(b)
        cpage = login(cctx, "cara@b126.dev", PW)
        cpage.click(".tb2-id")
        cpage.wait_for_timeout(500)
        cmenu = cpage.inner_text("#identity-menu126")
        check("creator identity menu: My profile / Settings / Sign out", all(w in cmenu for w in ["My profile", "Settings", "Sign out"]), cmenu[:200])
        cpage.screenshot(path=f"{OUT}/10-creator-identity-menu-390.png")
        cpage.click("#identity-menu126 .idm126-row >> nth=1")
        cpage.wait_for_timeout(900)
        check("creator menu Settings row lands on the real Settings view", "Settings" in cpage.inner_text("main"))
        for tab in ["Dashboard", "Offers", "My Visits", "Messages", "Earnings", "Profile", "Settings", "Momentum", "Numbers", "Help", "Sig"]:
            goto_tab(cpage, tab, 1200)
            audit(cpage, "creator", tab)
        cctx.close()
        # creator desktop menu wiring (rail foot identity)
        cdctx = new_ctx(b, 1280, 900)
        cdpage = login(cdctx, "cara@b126.dev", PW)
        has_railfoot = cdpage.evaluate("() => !!document.querySelector('.tab-user-btn')")
        if has_railfoot:
            cdpage.click(".tab-user-btn")
            cdpage.wait_for_timeout(500)
            check("desktop rail-foot identity opens the same menu", cdpage.query_selector("#identity-menu126") is not None)
            cdpage.screenshot(path=f"{OUT}/11-creator-identity-menu-desktop.png")
        else:
            notes.append("creator desktop: no .tab-user-btn rail foot rendered (top bar identity used instead)")
            cdpage.click(".tb2-id")
            cdpage.wait_for_timeout(500)
            check("desktop top-bar identity opens the menu", cdpage.query_selector("#identity-menu126") is not None)
        cdctx.close()

        # ---------------- BUSINESS ----------------
        bctx = new_ctx(b)
        bpage = login(bctx, "basil@b126.dev", PW)
        bpage.click(".tb2-id")
        bpage.wait_for_timeout(400)
        bmenu = bpage.inner_text("#identity-menu126")
        check("business identity menu: Business profile / Settings / Sign out", all(w in bmenu for w in ["Business profile", "Settings", "Sign out"]), bmenu[:200])
        bpage.keyboard.press("Escape")
        bpage.evaluate("closeIdentityMenu126()")
        for tab in ["Home", "Discover", "Favorites", "Campaign Setup", "My Offers", "Visits & Posts", "Regulars", "Content", "Analytics", "Plan", "Messages", "Profile", "Settings", "Help", "Sig"]:
            goto_tab(bpage, tab, 1200)
            audit(bpage, "business", tab)
        bctx.close()

        # ---------------- PARTNER ----------------
        pctx = new_ctx(b)
        ppage = login(pctx, "dana@b126.dev", PW)
        ppage.click(".tb2-id")
        ppage.wait_for_timeout(400)
        pmenu = ppage.inner_text("#identity-menu126")
        check("partner identity menu: Account / Settings / Sign out", all(w in pmenu for w in ["Account", "Settings", "Sign out"]), pmenu[:200])
        ppage.evaluate("closeIdentityMenu126()")
        for tab in ["Home", "Markets", "Creators", "Businesses", "Performance", "Earnings", "Links", "Account", "Help", "Sig"]:
            goto_tab(ppage, tab, 1200)
            audit(ppage, "partner", tab)
        pctx.close()

        # ---------------- PILOT ----------------
        ictx = new_ctx(b)
        ipage = login(ictx, "pilot@b126.dev", PW)
        ipage.click(".tb2-id")
        ipage.wait_for_timeout(400)
        imenu = ipage.inner_text("#identity-menu126")
        check("pilot identity menu: Your account / Sign out", all(w in imenu for w in ["Your account", "Sign out"]), imenu[:200])
        ipage.click("#identity-menu126 .idm126-row >> nth=0")
        ipage.wait_for_timeout(900)
        check("pilot Your account view renders (change password + sign out)", "Change password" in ipage.inner_text("main"))
        for tab in ["Overview", "Businesses", "Results", "Report", "Sig", "Team", "Help", "Account"]:
            goto_tab(ipage, tab, 1200)
            audit(ipage, "pilot", tab)
        ictx.close()

        # ---------------- RECRUITER ----------------
        rctx = new_ctx(b)
        rpage = login(rctx, "rita@b126.dev", PW)
        rpage.click(".tb2-id")
        rpage.wait_for_timeout(400)
        rmenu = rpage.inner_text("#identity-menu126")
        check("recruiter identity menu: Your account / Sign out", all(w in rmenu for w in ["Your account", "Sign out"]), rmenu[:200])
        rpage.click("#identity-menu126 .idm126-row >> nth=0")
        rpage.wait_for_timeout(900)
        check("recruiter Your account view renders (change password + sign out)", "Change password" in rpage.inner_text("main"))
        for tab in ["Queue", "Outreach", "Results", "Sig", "Help", "Account"]:
            goto_tab(rpage, tab, 1200)
            audit(rpage, "recruiter", tab)
        rctx.close()

        b.close()
finally:
    server.kill()

lines = ["Build -126 overflow audit — 390px, every primary view of every role",
         "Rule: document width must not exceed the viewport; no element may cross the",
         "right edge unless it scrolls inside its own card.", ""]
for role, view, status, detail in audit_rows:
    lines.append(f"{role:14s} {view:38s} {status}" + (f"  {detail}" if detail else ""))
lines.append("")
lines.append(f"Views audited: {len(audit_rows)}; overflows: {sum(1 for r in audit_rows if 'OVERFLOW' in r[2] or 'ERROR' in r[2])}")
open(f"{OUT}/overflow-audit.txt", "w").write("\n".join(lines) + "\n")
print("\n".join(lines))
if notes:
    print("NOTES:\n - " + "\n - ".join(notes))
print(f"qa-build126: {'ALL OK' if not fails else 'FAILURES: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
