#!/usr/bin/env python3
"""Build -125 Playwright QA (the navigation model):
- Per role (creator live + founding, business active + founding,
  partner, pilot, admin) at phone 390 and desktop 1440:
  the bottom bar / rail carries ONLY the design's daily stops
  under the design's labels (Wallet, never Money; no Profile
  junk drawer; no "More" anywhere).
- The Everything panel opens from the top-right button, shows
  the design's groups, and EVERY row is clicked through to
  prove it lands on a real view (panel closes, view changes).
- Creator Wallet: Cash · Comps · History sub-tabs with seeded
  paid-released / paid-held / comp / coupon / licence records —
  Cash total excludes comps; Comps shows face value labeled;
  History lists both, tagged, never summed.
- Business Wallet: Plan · Bookings · Receipts sub-tabs.
- Partner Wallet: Fund · Returns, strip reads Wallet.
- Admin: phone bar Review · Creators · Markets · Wallet; the
  Creators stop lands on the Command Center creators view;
  the Everything panel opens from the top row.
Chromium runs through the local relay (127.0.0.1:8899) with
loopback bypassed, per the standing QA chain. Seed mirrors
qa-build121.py (direct-DB, scrypt hashes) plus wallet records.
"""
import os, sys, subprocess, tempfile, time, urllib.request, json

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-build125-qa")
os.makedirs(OUT, exist_ok=True)
PORT = 9071
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-b125-qa-")
db = os.path.join(tmp, "db.json")
PW = "qa-pass-1234"

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const DAY = 86400000, now0 = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = {};
const put = (key, val) => { data[key] = val; };
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
const PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=";
put("config:markets", { flags: { Nashville: true } });
putUser({ id: "cara", role: "creator", email: "cara@b125qa.dev", name: "Cara Creators", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 40 * DAY), updatedAt: iso(now0 - 2 * DAY), reviewedAt: iso(now0 - 39 * DAY),
  creator: { handle: "caracreates", primaryPlatform: "instagram", followerCount: 12400, totalAudience: 15800, audienceStack: { instagram: 12400, tiktok: 3400 }, audienceMarkets: [{ market: "Nashville", pct: 74 }], categories: ["Food & Drink"], localAudiencePct: 74, tierBand: "Locals", profileComplete: true, hasPhoto: true, bio: "Nashville eats, weekly.", paidRate: 150, licensingFee: 150, momentumPoints: 340 } });
put("photo:cara", { contentType: "image/png", dataBase64: PX });
putUser({ id: "fiona", role: "creator", email: "fiona@b125qa.dev", name: "Fiona Founding", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 6 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 5 * DAY),
  creator: { handle: "fionafounding", primaryPlatform: "instagram", followerCount: 3100, totalAudience: 3100, audienceStack: { instagram: 3100 }, categories: ["Coffee & Bakery"], localAudiencePct: 71, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "Richmond coffee runs." } });
putUser({ id: "penny", role: "creator", email: "penny@b125qa.dev", name: "Penny Pending", passwordSalt: salt, passwordHash: hash, status: "pending", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 1 * DAY), updatedAt: iso(now0 - 1 * DAY),
  creator: { handle: "pennyposts", primaryPlatform: "instagram", followerCount: 8200, totalAudience: 8200, audienceStack: { instagram: 8200 }, categories: ["Coffee & Bakery"], localAudiencePct: 66, tierBand: "Locals", profileComplete: true, hasPhoto: false, bio: "" } });
putUser({ id: "basil", role: "business", email: "basil@b125qa.dev", name: "Basil Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: iso(now0 - 30 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 29 * DAY),
  business: { businessName: "Basil & Co", category: "Restaurant", plan: "growth", planId: "growth", planName: "Growth $349/mo", accessState: "active", about: "Wood-fired kitchen in East Nashville.", address: "1000 Woodland St" } });
putUser({ id: "faye", role: "business", email: "faye@b125qa.dev", name: "Faye Founder", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Richmond", city: "Richmond", createdAt: iso(now0 - 5 * DAY), updatedAt: iso(now0 - 1 * DAY), reviewedAt: iso(now0 - 4 * DAY),
  business: { businessName: "Faye's Bakery", category: "Bakery", plan: "self-service", planId: "self-service", accessState: "founding", about: "" } });
putUser({ id: "patp", role: "partner", email: "pat@b125qa.dev", name: "Pat Partner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", createdAt: iso(now0 - 60 * DAY), updatedAt: iso(now0 - 3 * DAY), reviewedAt: iso(now0 - 59 * DAY), termsVersion: "2026-10-19", termsAcceptedAt: iso(now0 - 59 * DAY), creator: null, business: null,
  partner: { name: "Pat Media Group", code: "patmedia", type: "media", contactName: "Pat Partner", markets: ["Nashville"], sharePct: 35, status: "active", agreementStatus: "signed", agreementSignedAt: iso(now0 - 59 * DAY), demo: false } });
put("pilot:pilot-125", { id: "pilot-125", name: "Nashville First Visits Pilot", partnerName: "City Fund", marketId: "nashville", marketName: "Nashville", fundCents: 500000, status: "active", partnerUserId: "fayefund", createdAt: iso(now0 - 20 * DAY), updatedAt: iso(now0 - 2 * DAY) });
putUser({ id: "fayefund", role: "pilot_partner", email: "fund@b125qa.dev", name: "Faye Fund", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", pilotId: "pilot-125", createdAt: iso(now0 - 20 * DAY), updatedAt: iso(now0 - 2 * DAY), creator: null, business: null });
put("pilotbiz:pilot-125:pb1", { id: "pb1", pilotId: "pilot-125", businessId: "basil", name: "Basil & Co", marketName: "Nashville", status: "selected", createdAt: iso(now0 - 10 * DAY), updatedAt: iso(now0 - 2 * DAY) });
// ---- Cara's wallet records (paid released / paid held / comp / coupon) ----
put("booking:bk-paid-rel", { id: "bk-paid-rel", creatorId: "cara", businessId: "basil", businessName: "Basil & Co", creatorName: "Cara Creators", title: "New menu shoot: paid visit", kind: "paid", status: "booked", market: "Nashville", createdAt: iso(now0 - 4 * DAY), redeemedAt: iso(now0 - 3 * DAY),
  paidLane: { rate: 150, creatorNet: 145.5, businessTotal: 154.5, platformFee: 9, escrowState: "released" } });
put("post:pp1", { id: "pp1", bookingId: "bk-paid-rel", creatorId: "cara", url: "https://instagram.com/p/qa125/", submittedAt: iso(now0 - 2 * DAY), firstAt: iso(now0 - 2 * DAY), onTime: true });
put("booking:bk-paid-held", { id: "bk-paid-held", creatorId: "cara", businessId: "basil", businessName: "Basil & Co", creatorName: "Cara Creators", title: "Brunch launch: paid visit", kind: "paid", status: "booked", market: "Nashville", createdAt: iso(now0 - 1 * DAY),
  paidLane: { rate: 200, creatorNet: 194, businessTotal: 206, platformFee: 12, escrowState: "held" } });
put("booking:bk-comp", { id: "bk-comp", creatorId: "cara", businessId: "basil", businessName: "Basil & Co", creatorName: "Cara Creators", title: "Dinner for two, on us", kind: "comp", status: "booked", market: "Nashville", createdAt: iso(now0 - 6 * DAY), redeemedAt: iso(now0 - 3 * DAY), dollarCap: 120, whatComped: "Dinner for two: two mains, two drinks" });
put("booking:bk-coupon", { id: "bk-coupon", creatorId: "cara", businessId: "basil", businessName: "Basil & Co", creatorName: "Cara Creators", title: "Bakery box post", kind: "coupon", status: "booked", market: "Nashville", createdAt: iso(now0 - 4 * DAY), redeemedAt: iso(now0 - 2 * DAY),
  coupon: { type: "store_credit", amount: 75, appliesTo: "Anything in the store" } });
put("license:lic1", { id: "lic1", creatorId: "cara", businessId: "basil", businessName: "Basil & Co", postId: "pp1", fee: 150, creatorNet: 145.5, status: "granted", createdAt: iso(now0 - 1 * DAY), windowEndsAt: iso(now0 + 89 * DAY) });
put("license:lic2", { id: "lic2", creatorId: "cara", businessId: "basil", businessName: "Basil & Co", postId: "pp1", fee: 150, creatorNet: 145.5, status: "pending", createdAt: iso(now0 - 1 * DAY) });
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db], check=True)

ADMIN_PW = "qa-admin-" + "pass-125"
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_TEST_ALLOW_BUSINESS="1",
           SIGNL_MAIL_STUB="1", APP_URL=BASE)
env["ADMIN_EMAIL"] = "admin@b125.dev"
env["ADMIN_PASSWORD"] = ADMIN_PW
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"]:
    env.pop(k, None)
_srv_log = open(os.path.join(OUT, "server.log"), "w")
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=_srv_log, stderr=_srv_log)
R = {}
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def overflow(page):
            return page.evaluate("Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) - window.innerWidth")

        def login(ctx, email, pw=PW):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
            return r.status

        def open_role(email, width, height, pw=PW, touch=False):
            opts = {"viewport": {"width": width, "height": height}, "ignore_https_errors": True}
            if touch:
                opts.update({"has_touch": True, "is_mobile": True, "device_scale_factor": 3})
            ctx = b.new_context(**opts)
            page = ctx.new_page()
            page.on("dialog", lambda d: d.accept())
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)[:120]))
            st = login(ctx, email, pw)
            page.goto(BASE + "/", wait_until="networkidle")
            page.wait_for_timeout(2600)
            return ctx, page, st, errs

        def shot(page, name):
            page.screenshot(path=os.path.join(OUT, name), full_page=True)

        def visible_bar_labels(page):
            return page.evaluate("""() => [...document.querySelectorAll('#tabbar .tab-item')]
              .filter((e) => getComputedStyle(e).display !== 'none')
              .map((e) => { const l = e.querySelector('.tab-label'); return (l ? l.innerText : e.innerText).trim(); })""")

        def open_panel(page, btn_sel):
            if page.locator("#everything-panel125").count():
                page.evaluate("closeEverything125()")
                page.wait_for_timeout(250)
            page.locator(btn_sel).first.click(timeout=4000)
            page.wait_for_timeout(600)
            return page.evaluate("""() => {
              const pn = document.querySelector('#everything-panel125');
              if (!pn) return null;
              const groups = [...pn.querySelectorAll('.ev125-group')].map((g) => ({
                title: g.querySelector('h5') ? g.querySelector('h5').innerText.trim() : '',
                rows: [...g.querySelectorAll('.ev125-row')].map((r) => {
                  const l = r.querySelector('.more-label'); const s = r.querySelector('.ev125-status');
                  return (l ? l.innerText.trim() : r.innerText.trim()) + (s ? ' [' + s.innerText.trim() + ']' : '');
                }),
              }));
              return { title: pn.querySelector('.ev125-head strong') ? pn.querySelector('.ev125-head strong').innerText.trim() : '', groups };
            }""")

        def panel_landings(page, btn_sel, skip_labels=()):
            """Click every panel row; record where it lands. Reopens the panel each time."""
            info = open_panel(page, btn_sel)
            labels = []
            for g in (info or {}).get("groups", []):
                labels += [r.split(" [")[0] for r in g["rows"]]
            landings = {}
            for label in labels:
                if label in skip_labels:
                    landings[label] = "SKIPPED (recorded present, not clicked)"
                    continue
                try:
                    if not page.locator("#everything-panel125").count():
                        open_panel(page, btn_sel)
                    row = page.locator("#everything-panel125 .ev125-row", has_text=label).first
                    href = row.evaluate("e => e.getAttribute('href')")
                    if href and href.startswith("mailto:"):
                        landings[label] = "mailto link (not clicked)"
                        page.evaluate("closeEverything125()")
                        continue
                    row.click(timeout=3000)
                    page.wait_for_timeout(1300)
                    landings[label] = page.evaluate("""() => {
                      const closed = !document.querySelector('#everything-panel125');
                      const h = document.querySelector('#tab-body .ws-title, #tab-body h2, #tab-body h3');
                      const tb = document.querySelector('#tab-body');
                      return { panelClosed: closed, head: h ? h.innerText.trim().slice(0, 60) : null,
                               bodyStart: tb ? tb.innerText.replace(/\\s+/g, ' ').slice(0, 70) : null };
                    }""")
                except Exception as e:
                    landings[label] = f"ERR {str(e)[:110]}"
            return info, landings

        def ws_title(page):
            return page.evaluate("() => { const h = document.querySelector('#tab-body .ws-title'); return h ? h.innerText.trim() : null; }")

        def click_bar(page, label):
            page.evaluate("""(label) => {
              const it = [...document.querySelectorAll('#tabbar .tab-item')]
                .find((e) => { const l = e.querySelector('.tab-label'); return l && l.innerText.trim() === label; });
              if (it) it.click();
            }""", label)
            page.wait_for_timeout(1500)

        # ============ CREATOR PHONE (390) ============
        cctx, cpage, cst, cerrs = open_role("cara@b125qa.dev", 390, 844, touch=True)
        R["creator_login"] = cst
        R["creator_page_errors"] = cerrs
        R["creator_bar_390"] = visible_bar_labels(cpage)
        shot(cpage, "creator-home-390.png")
        R["creator_overflow_390"] = overflow(cpage)
        cinfo, cland = panel_landings(cpage, ".tb2-ev125")
        R["creator_panel"] = cinfo
        R["creator_panel_landings"] = cland
        shot(cpage, "creator-panel-390.png") if False else None
        # panel shot: reopen and capture viewport (panel is fixed-position)
        open_panel(cpage, ".tb2-ev125")
        cpage.screenshot(path=os.path.join(OUT, "creator-panel-390.png"))
        cpage.evaluate("closeEverything125()")
        # Wallet: Cash
        click_bar(cpage, "Wallet")
        R["creator_wallet_title"] = ws_title(cpage)
        cash = cpage.evaluate("""() => {
          const tabs = [...document.querySelectorAll('#tab-body .ws-tab')].map((t) => t.innerText.trim());
          const kpis = [...document.querySelectorAll('#tab-body .kpi-card')].map((k) => k.innerText.replace(/\\s+/g, ' '));
          return { tabs, kpis, hasWaiting: document.querySelector('#tab-body').innerText.includes('Waiting on you') };
        }""")
        R["creator_wallet_cash"] = cash
        shot(cpage, "creator-wallet-cash-390.png")
        # Wallet: Comps
        cpage.locator("#tab-body .ws-tab", has_text="Comps").first.click(timeout=3000)
        cpage.wait_for_timeout(1200)
        comps = cpage.evaluate("""() => {
          const kpis = [...document.querySelectorAll('#tab-body .kpi-card')].map((k) => k.innerText.replace(/\\s+/g, ' '));
          const txt = document.querySelector('#tab-body').innerText;
          return { kpis, hasDinner: txt.includes('Dinner for two'), hasStoreValue: txt.includes('store value'), hasNotCash: txt.includes('not cash') };
        }""")
        R["creator_wallet_comps"] = comps
        shot(cpage, "creator-wallet-comps-390.png")
        # Wallet: History
        cpage.locator("#tab-body .ws-tab", has_text="History").first.click(timeout=3000)
        cpage.wait_for_timeout(1200)
        hist = cpage.evaluate("""() => {
          const rows = [...document.querySelectorAll('#tab-body .lib-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').slice(0, 110));
          const txt = document.querySelector('#tab-body').innerText;
          const foot = txt.includes('never added together') ? txt.slice(txt.indexOf('Cash earned'), txt.indexOf('Cash earned') + 120) : null;
          return { rows, foot };
        }""")
        R["creator_wallet_history"] = hist
        shot(cpage, "creator-wallet-history-390.png")
        # Profile = real profile only
        info2 = open_panel(cpage, ".tb2-ev125")
        cpage.locator("#everything-panel125 .ev125-row", has_text="My profile").first.click(timeout=3000)
        cpage.wait_for_timeout(1500)
        prof = cpage.evaluate("""() => {
          const tb = document.querySelector('#tab-body');
          return { title: tb.querySelector('.ws-title') ? tb.querySelector('.ws-title').innerText.trim() : null,
                   hasMoreList: !!tb.querySelector('.more-list'), hasMomentumPanel: tb.innerText.includes('Momentum points'),
                   hasGrowRoster: tb.innerText.includes('Grow your roster'), hasSegs: [...tb.querySelectorAll('.ws-tab')].map((t) => t.innerText.trim()) };
        }""")
        R["creator_profile_only"] = prof
        shot(cpage, "creator-profile-390.png")
        cctx.close()

        # ============ CREATOR DESKTOP (1440) ============
        dctx, dpage, _, derrs = open_role("cara@b125qa.dev", 1440, 900)
        R["creator_desktop_errors"] = derrs
        R["creator_rail_desktop"] = visible_bar_labels(dpage)
        dinfo = open_panel(dpage, ".tab-ev125")
        R["creator_panel_desktop_groups"] = [g["title"] for g in (dinfo or {}).get("groups", [])]
        dpage.screenshot(path=os.path.join(OUT, "creator-panel-desktop.png"))
        dpage.evaluate("closeEverything125()")
        click_bar(dpage, "Wallet")
        R["creator_wallet_title_desktop"] = ws_title(dpage)
        R["creator_overflow_desktop"] = overflow(dpage)
        shot(dpage, "creator-wallet-desktop.png")
        dctx.close()

        # ============ FOUNDING CREATOR PHONE ============
        fctx, fpage, _, ferrs = open_role("fiona@b125qa.dev", 390, 844, touch=True)
        R["founding_creator_errors"] = ferrs
        R["founding_creator_bar_390"] = visible_bar_labels(fpage)
        finfo, fland = panel_landings(fpage, ".tb2-ev125")
        R["founding_creator_panel"] = finfo
        R["founding_creator_landings"] = fland
        fctx.close()

        # ============ BUSINESS PHONE + DESKTOP ============
        bctx, bpage, bst, berrs = open_role("basil@b125qa.dev", 390, 844, touch=True)
        R["business_login"] = bst
        R["business_page_errors"] = berrs
        R["business_bar_390"] = visible_bar_labels(bpage)
        shot(bpage, "business-home-390.png")
        binfo, bland = panel_landings(bpage, ".tb2-ev125")
        R["business_panel"] = binfo
        R["business_panel_landings"] = bland
        open_panel(bpage, ".tb2-ev125")
        bpage.screenshot(path=os.path.join(OUT, "business-panel-390.png"))
        bpage.evaluate("closeEverything125()")
        click_bar(bpage, "Wallet")
        R["business_wallet_title"] = ws_title(bpage)
        R["business_wallet_tabs"] = bpage.evaluate("[...document.querySelectorAll('#tab-body .ws-tab')].map((t) => t.innerText.trim())")
        shot(bpage, "business-wallet-plan-390.png")
        bpage.locator("#tab-body .ws-tab", has_text="Bookings").first.click(timeout=3000)
        bpage.wait_for_timeout(1500)
        R["business_wallet_bookings"] = bpage.evaluate("""() => {
          const rows = [...document.querySelectorAll('#biz-wallet-bookings .lib-row')].map((r) => r.innerText.replace(/\\s+/g, ' ').slice(0, 130));
          return rows;
        }""")
        shot(bpage, "business-wallet-bookings-390.png")
        bpage.locator("#tab-body .ws-tab", has_text="Receipts").first.click(timeout=3000)
        bpage.wait_for_timeout(1800)
        R["business_wallet_receipts"] = bpage.evaluate("""() => {
          const h = document.querySelector('#biz-receipt-export');
          return h ? h.innerText.replace(/\\s+/g, ' ').slice(0, 160) : null;
        }""")
        shot(bpage, "business-wallet-receipts-390.png")
        R["business_overflow_390"] = overflow(bpage)
        bctx.close()

        bdctx, bdpage, _, _ = open_role("basil@b125qa.dev", 1440, 900)
        R["business_rail_desktop"] = visible_bar_labels(bdpage)
        bdinfo = open_panel(bdpage, ".tab-ev125")
        R["business_panel_desktop_groups"] = [g["title"] for g in (bdinfo or {}).get("groups", [])]
        bdpage.screenshot(path=os.path.join(OUT, "business-panel-desktop.png"))
        bdctx.close()

        # ============ FOUNDING BUSINESS (slim shell) PHONE ============
        fbctx, fbpage, _, fberrs = open_role("faye@b125qa.dev", 390, 844, touch=True)
        R["founding_business_errors"] = fberrs
        fbinfo, fbland = panel_landings(fbpage, ".tb2-ev125")
        R["founding_business_panel"] = fbinfo
        R["founding_business_landings"] = fbland
        fbctx.close()

        # ============ PARTNER PHONE + DESKTOP ============
        pctx, ppage, pst, perrs = open_role("pat@b125qa.dev", 390, 844, touch=True)
        R["partner_login"] = pst
        R["partner_page_errors"] = perrs
        R["partner_bar_390"] = visible_bar_labels(ppage)
        shot(ppage, "partner-home-390.png")
        pinfo, pland = panel_landings(ppage, ".tb2-ev125")
        R["partner_panel"] = pinfo
        R["partner_panel_landings"] = pland
        open_panel(ppage, ".tb2-ev125")
        ppage.screenshot(path=os.path.join(OUT, "partner-panel-390.png"))
        ppage.evaluate("closeEverything125()")
        click_bar(ppage, "Wallet")
        R["partner_wallet_title"] = ws_title(ppage)
        R["partner_wallet_tabs"] = ppage.evaluate("[...document.querySelectorAll('#tab-body .ws-tab')].map((t) => t.innerText.trim())")
        R["partner_strip"] = ppage.evaluate("[...document.querySelectorAll('.ws-tabs .ws-tab')].map((t) => t.innerText.trim())")
        shot(ppage, "partner-wallet-390.png")
        pctx.close()

        pdctx, pdpage, _, _ = open_role("pat@b125qa.dev", 1440, 900)
        R["partner_rail_desktop"] = visible_bar_labels(pdpage)
        pdctx.close()

        # ============ PILOT PHONE ============
        plctx, plpage, _, plerrs = open_role("fund@b125qa.dev", 390, 844, touch=True)
        R["pilot_page_errors"] = plerrs
        R["pilot_bar_390"] = visible_bar_labels(plpage)
        plinfo, plland = panel_landings(plpage, ".tb2-ev125")
        R["pilot_panel"] = plinfo
        R["pilot_panel_landings"] = plland
        plctx.close()

        # ============ ADMIN DESKTOP + PHONE ============
        actx, apage, ast, aerrs = open_role("admin@b125.dev", 1440, 900, ADMIN_PW)
        R["admin_login"] = ast
        R["admin_page_errors"] = aerrs
        R["admin_rail_labels_desktop"] = apage.evaluate("""() => [...document.querySelectorAll('#rail .rail-item')]
          .map((e) => { const l = e.querySelector('.rail-label-full') || e.querySelector('.rail-label'); return l ? l.innerText.trim() : ''; }).filter(Boolean)""")
        ainfo = open_panel(apage, ".tr-ev125")
        R["admin_panel"] = ainfo
        apage.screenshot(path=os.path.join(OUT, "admin-panel-desktop.png"))
        apage.evaluate("closeEverything125()")
        shot(apage, "admin-home-desktop.png")
        actx.close()

        amctx, ampage, _, amerrs = open_role("admin@b125.dev", 390, 844, ADMIN_PW, touch=True)
        R["admin_phone_errors"] = amerrs
        R["admin_bar_390"] = ampage.evaluate("""() => [...document.querySelectorAll('#rail .rail-item.rail-primary')]
          .filter((e) => getComputedStyle(e).display !== 'none')
          .map((e) => { const l = e.querySelector('.rail-label-short') || e.querySelector('.rail-label'); return l ? l.innerText.trim() : ''; })""")
        shot(ampage, "admin-home-390.png")
        ainfo2, aland = panel_landings(ampage, ".tr-ev125", skip_labels=("Preview as business", "Business dashboard"))
        R["admin_panel_phone"] = ainfo2
        R["admin_panel_landings"] = aland
        # the Creators bar stop lands on the Command Center creators view
        ampage.evaluate("closeEverything125()")
        ampage.locator("#rail .rail-item", has_text="Creators").first.click(timeout=3000)
        ampage.wait_for_timeout(1800)
        R["admin_creators_landing"] = ampage.evaluate("""() => {
          const on = [...document.querySelectorAll('.ws-tab')].find((t) => t.classList.contains('on'));
          return { activeTab: on ? on.innerText.trim() : null,
                   bodyStart: document.querySelector('#tab-body') ? document.querySelector('#tab-body').innerText.replace(/\\s+/g, ' ').slice(0, 90) : null };
        }""")
        shot(ampage, "admin-creators-390.png")
        # the Wallet bar stop (Stats item) + Wallet sub-tab
        ampage.locator("#rail .rail-item.rail-primary").filter(has_text="Wallet").first.click(timeout=3000)
        ampage.wait_for_timeout(1500)
        ampage.evaluate("ccSetTab('money')")
        ampage.wait_for_timeout(1500)
        R["admin_wallet_tab"] = ampage.evaluate("""() => {
          const tabs = [...document.querySelectorAll('.ws-tab')].map((t) => t.innerText.trim());
          const on = [...document.querySelectorAll('.ws-tab')].find((t) => t.classList.contains('on'));
          return { tabs, active: on ? on.innerText.trim() : null };
        }""")
        shot(ampage, "admin-wallet-390.png")
        R["admin_overflow_390"] = overflow(ampage)
        R["admin_overflow_elems"] = ampage.evaluate("""() => {
          const out = [];
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth + 2 && r.width > 0) out.push(el.tagName + '.' + (el.className && el.className.baseVal !== undefined ? '' : String(el.className).slice(0, 40)) + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width));
            if (out.length >= 8) break;
          }
          return out;
        }""")
        amctx.close()

    with open(os.path.join(OUT, "results.json"), "w") as f:
        json.dump(R, f, indent=1, default=str)
    print(json.dumps(R, indent=1, default=str)[:6000])
finally:
    server.kill()
print("QA OUT:", OUT)
