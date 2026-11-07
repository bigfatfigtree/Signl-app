#!/usr/bin/env python3
"""Messages desktop rebuild QA (Jeff, 2026-11-07).

Rendered assertions, not just captures:
- Desktop 1440: surface capped at the 1180px content column;
  "See offers" sits in the toolbar cluster (right after the
  segmented switch), NOT at the screen edge; two-pane layout
  (372px list + reading pane); empty state centered INSIDE the
  pane; avatars render (Maggie tile for the team thread, the
  business photo for a business thread, initial tile when no
  photo); opening a thread populates the pane + head avatar;
  composer sends; search filters; no horizontal overflow.
- Mobile 390: same structure stacked as before, controls
  reachable, avatars render, no overflow (mobile behavior
  unchanged).
- Business desktop: parity — same panes, "Find creators" in
  the cluster, creator photo avatar.
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-msg-desktop-qa-2026-11-07")
os.makedirs(OUT, exist_ok=True)
PORT = 9087
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-msg-qa-")
db = os.path.join(tmp, "db.json")

seed_js = r"""
const crypto = require("crypto");
const fs = require("fs");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("qa-pass-1234", salt, 64).toString("hex");
const now = "2026-11-07T14:00:00.000Z";
const data = {};
const putUser = (u) => { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; };
putUser({ id: "msgcr", role: "creator", email: "carly@msgqa.dev", name: "Carly Creator", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: now, updatedAt: now,
  creator: { handle: "carlycreates", primaryPlatform: "instagram", followerCount: 5200, totalAudience: 5200, audienceStack: { instagram: 5200 }, categories: ["Food & Drink"], localAudiencePct: 68, tierBand: "Locals", profileComplete: true, publicPage: true, hasPhoto: true, photoCount: 1, bio: "Nashville food creator." } });
putUser({ id: "msgbiz", role: "business", email: "owner@msgqa.dev", name: "Ben Baker", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: now, updatedAt: now,
  business: { businessName: "Salt & Stone Kitchen", category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "active", hasPhoto: true, about: "Wood-fired kitchen." } });
putUser({ id: "msgbiz2", role: "business", email: "blue@msgqa.dev", name: "Bea Blue", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: now, updatedAt: now,
  business: { businessName: "Blue Door Bakery", category: "Bakery", plan: "self-service", planId: "self-service", accessState: "active", hasPhoto: false, about: "Bakery." } });
const photoCr = fs.readFileSync(process.argv[3]);
data["photo:msgcr"] = { contentType: "image/jpeg", dataBase64: photoCr.toString("base64") };
const photoBiz = fs.readFileSync(process.argv[4]);
data["photo:msgbiz"] = { contentType: "image/png", dataBase64: photoBiz.toString("base64") };
data["config:markets"] = { flags: { "Nashville": true } };
const msg = (id, threadId, fromId, toId, body, createdAt, platform) => { data[`message:${id}`] = { id, threadId, fromId, toId, body, createdAt, ...(platform ? { platform: true } : {}) }; };
msg("m1", "msgcr__signl-team", "signl-team", "msgcr", "Quick news, the good kind: SIGNL is now Magpie. Same account, same founding spot, nothing to redo.", "2026-11-07T19:54:00.000Z", true);
msg("m2", "msgbiz__msgcr", "msgbiz", "msgcr", "Hi Carly — your last reel is exactly our room. Would you come in for a comped dinner for two?", "2026-11-07T16:10:00.000Z");
msg("m3", "msgbiz__msgcr", "msgcr", "msgbiz", "Thanks for thinking of me! Saturday works for us.", "2026-11-07T17:20:00.000Z");
msg("m4", "msgbiz__msgcr", "msgbiz", "msgcr", "Perfect — see you at 11? The chef will set the counter seats.", "2026-11-07T18:05:00.000Z");
msg("m5", "msgbiz2__msgcr", "msgbiz2", "msgcr", "Hello! We would love to host you at the bakery counter next week.", "2026-11-07T15:30:00.000Z");
fs.writeFileSync(process.argv[2], JSON.stringify(data));
"""
seed_path = os.path.join(tmp, "seed.cjs")
open(seed_path, "w").write(seed_js)
subprocess.run(["node", seed_path, db, os.path.join(ROOT, "public/assets/maggie-char/curious.jpg"), os.path.join(ROOT, "public/assets/logo.png")], check=True)

env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1", APP_URL=BASE)
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
R = {}
FAILS = []
def check(name, cond, detail=""):
    R[name] = detail if detail else ("ok" if cond else "FAIL")
    if not cond:
        FAILS.append(name)

try:
    _opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            _opener.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)

    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium", proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})

        def login(ctx, email):
            r = ctx.request.post(BASE + "/api/auth/login", data={"email": email, "password": "qa-pass-1234"})
            assert r.status == 200, f"login {email} -> {r.status}"

        def open_messages(page):
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
            page.evaluate("go('dashboard','Messages')")
            page.wait_for_selector("#thread-list-wrap .thread-item", timeout=30000)
            page.wait_for_timeout(600)

        # ============ CREATOR DESKTOP 1440 ============
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "carly@msgqa.dev")
        page = ctx.new_page()
        open_messages(page)

        m = page.evaluate("""() => {
          const q = (s) => document.querySelector(s);
          const bb = (el) => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height}; };
          const wrap = q('.msg-wrap'), btn = [...document.querySelectorAll('.msg-tools .btn')].find(x => /See offers|Find creators/.test(x.textContent)),
                seg = q('#msg-seg'), panes = q('.msg-panes'), listCol = q('.msg-list-col'), view = q('.msg-view'),
                empty = q('.msg-empty'), rows = [...document.querySelectorAll('.thread-item')];
          return {
            wrap: bb(wrap), btn: bb(btn), btnText: btn.textContent.trim(), segRight: bb(seg).right,
            panes: bb(panes), listCol: bb(listCol), view: bb(view),
            emptyInView: empty ? (bb(empty).left >= bb(view).left && bb(empty).right <= bb(view).right + 1) : false,
            emptyText: empty ? empty.textContent.trim() : "",
            rowCount: rows.length,
            rows: rows.map(rw => { const img = rw.querySelector('img.thread-av'); const init = rw.querySelector('.thread-av.init');
              return { name: (rw.querySelector('.thread-top strong') || {}).textContent || "", imgSrc: img ? img.getAttribute('src') : null,
                       imgOk: img ? (img.complete && img.naturalWidth > 0) : false, init: init ? init.textContent.trim() : null }; }),
            scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), innerW: window.innerWidth, innerH: window.innerHeight
          };
        }""")
        R["desktop_metrics"] = str({k: m[k] for k in ["btnText", "rowCount", "emptyText"]}) + f" wrapW={m['wrap']['width']:.0f} btnRight={m['btn']['right']:.0f} wrapRight={m['wrap']['right']:.0f} listW={m['listCol']['width']:.0f} panesBottom={m['panes']['bottom']:.0f}/{m['innerH']}"
        check("wrap capped 1180", m["wrap"]["width"] <= 1181, f"{m['wrap']['width']:.0f}")
        check("see-offers in cluster (gap after seg <= 16)", m["btn"]["left"] - m["segRight"] <= 16, f"gap={m['btn']['left'] - m['segRight']:.0f}")
        check("see-offers inside wrap", m["btn"]["right"] <= m["wrap"]["right"] + 1, f"{m['btn']['right']:.0f} vs {m['wrap']['right']:.0f}")
        check("list column 372", abs(m["listCol"]["width"] - 372) <= 4, f"{m['listCol']['width']:.0f}")
        check("empty state inside pane", m["emptyInView"] and "Pick a conversation" in m["emptyText"], m["emptyText"])
        check("3 rows", m["rowCount"] == 3, str(m["rowCount"]))
        by_name = {r["name"]: r for r in m["rows"]}
        check("team row Maggie tile loaded", by_name.get("Magpie", {}).get("imgOk") and "maggie-char/curious.jpg" in (by_name.get("Magpie", {}).get("imgSrc") or ""), str(by_name.get("Magpie")))
        check("business row photo loaded", by_name.get("Salt & Stone Kitchen", {}).get("imgOk") and "/api/users/msgbiz/photo" in (by_name.get("Salt & Stone Kitchen", {}).get("imgSrc") or ""), str(by_name.get("Salt & Stone Kitchen")))
        check("no-photo row initial tile B", by_name.get("Blue Door Bakery", {}).get("init") == "B" and not by_name.get("Blue Door Bakery", {}).get("imgSrc"), str(by_name.get("Blue Door Bakery")))
        check("no h-overflow desktop", m["scrollW"] <= m["innerW"], f"{m['scrollW']} vs {m['innerW']}")
        page.screenshot(path=os.path.join(OUT, "01-creator-messages-desktop-empty.png"))

        # open the business thread
        page.click(".thread-item:has-text('Salt & Stone Kitchen')")
        page.wait_for_selector("#msg-list .msg", timeout=15000)
        page.wait_for_timeout(500)
        t = page.evaluate("""() => {
          const head = document.querySelector('.thread-head');
          const img = head ? head.querySelector('img.thread-av') : null;
          const msgs = [...document.querySelectorAll('#msg-list .msg')].map(x => x.textContent);
          return { headText: head ? head.textContent.replace(/\\s+/g,' ').trim() : "", headImgOk: img ? (img.complete && img.naturalWidth > 0) : false,
                   msgCount: msgs.length, hasTheirs: msgs.some(x => x.includes('see you at 11')), hasMine: msgs.some(x => x.includes('Saturday works')),
                   composer: !!document.querySelector('#msg-body') };
        }""")
        R["thread_open"] = t["headText"][:110]
        check("thread head name+avatar", "Salt & Stone Kitchen" in t["headText"] and t["headImgOk"], t["headText"][:80])
        check("thread messages render", t["msgCount"] == 3 and t["hasTheirs"] and t["hasMine"], f"n={t['msgCount']}")
        check("composer present", t["composer"])
        page.screenshot(path=os.path.join(OUT, "02-creator-thread-open-desktop.png"))

        # composer actually sends
        page.fill("#msg-body", "Counter seats sound perfect — see you then.")
        page.click(".msg-composer button[type=submit]")
        page.wait_for_selector("#msg-list .msg:has-text('Counter seats sound perfect')", timeout=15000)
        check("composer sends", True)

        # search filters the list
        page.fill("#msg-q", "Blue Door")
        page.wait_for_timeout(700)
        n = page.locator(".thread-item").count()
        check("search filters to 1", n == 1, f"n={n}")
        page.fill("#msg-q", "")
        page.wait_for_timeout(700)
        n = page.locator(".thread-item").count()
        check("search clear restores 3", n == 3, f"n={n}")
        # segmented switch works
        page.click("#msg-seg button:has-text('Waiting on you')")
        page.wait_for_timeout(700)
        n = page.locator(".thread-item").count()
        check("waiting filter shows 3 (all last-from-other)", n == 3, f"n={n}")
        page.click("#msg-seg button:has-text('All')")
        page.wait_for_timeout(500)
        ctx.close()

        # ============ CREATOR MOBILE 390 ============
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        login(ctx, "carly@msgqa.dev")
        page = ctx.new_page()
        open_messages(page)
        mm = page.evaluate("""() => {
          const bb = (el) => { const r = el.getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, width: r.width}; };
          const panes = document.querySelector('.msg-panes'), list = document.querySelector('.msg-list-col'), view = document.querySelector('.msg-view');
          const btn = [...document.querySelectorAll('.msg-tools .btn')].find(x => /See offers/.test(x.textContent));
          const img = document.querySelector('.thread-item img.thread-av');
          return { panes: bb(panes), list: bb(list), view: bb(view), stacked: bb(view).top >= bb(list).top, btnVisible: !!btn && btn.offsetParent !== null,
                   imgOk: img ? (img.complete && img.naturalWidth > 0) : false,
                   scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), innerW: window.innerWidth };
        }""")
        check("mobile stacked (view below list)", mm["stacked"], f"listTop={mm['list']['top']:.0f} viewTop={mm['view']['top']:.0f}")
        check("mobile see-offers visible", mm["btnVisible"])
        check("mobile avatar renders", mm["imgOk"])
        check("no h-overflow mobile", mm["scrollW"] <= mm["innerW"], f"{mm['scrollW']} vs {mm['innerW']}")
        page.screenshot(path=os.path.join(OUT, "03-creator-messages-mobile.png"), full_page=True)
        page.click(".thread-item:has-text('Salt & Stone Kitchen')")
        page.wait_for_selector("#msg-list .msg", timeout=15000)
        page.wait_for_timeout(400)
        okc = page.evaluate("() => !!document.querySelector('#msg-body') && document.querySelectorAll('#msg-list .msg').length >= 3")
        check("mobile thread opens with composer", okc)
        page.screenshot(path=os.path.join(OUT, "04-creator-thread-mobile.png"), full_page=True)
        ctx.close()

        # ============ BUSINESS DESKTOP (parity) ============
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "owner@msgqa.dev")
        page = ctx.new_page()
        open_messages(page)
        bm = page.evaluate("""() => {
          const btn = [...document.querySelectorAll('.msg-tools .btn')].find(x => /Find creators/.test(x.textContent));
          const seg = document.querySelector('#msg-seg');
          const row = [...document.querySelectorAll('.thread-item')].map(rw => { const img = rw.querySelector('img.thread-av');
            return { name: (rw.querySelector('.thread-top strong') || {}).textContent || "", imgSrc: img ? img.getAttribute('src') : null, imgOk: img ? (img.complete && img.naturalWidth > 0) : false }; });
          return { btnGap: btn ? btn.getBoundingClientRect().left - seg.getBoundingClientRect().right : -1, rows: row };
        }""")
        crow = [r for r in bm["rows"] if r["name"] == "Carly Creator"]
        check("business: Find creators in cluster", 0 <= bm["btnGap"] <= 16, f"gap={bm['btnGap']:.0f}")
        check("business: creator photo avatar", bool(crow) and crow[0]["imgOk"] and "/api/users/msgcr/photo" in (crow[0]["imgSrc"] or ""), str(crow))
        page.click(".thread-item:has-text('Carly Creator')")
        page.wait_for_selector("#msg-list .msg", timeout=15000)
        page.wait_for_timeout(400)
        bh = page.evaluate("() => { const h = document.querySelector('.thread-head'); const img = h ? h.querySelector('img.thread-av') : null; return { text: h ? h.textContent.replace(/\\s+/g,' ').trim() : '', imgOk: img ? (img.complete && img.naturalWidth > 0) : false }; }")
        check("business: thread head avatar+name", "Carly Creator" in bh["text"] and bh["imgOk"], bh["text"][:80])
        page.screenshot(path=os.path.join(OUT, "05-business-thread-desktop.png"))
        ctx.close()
        b.close()

    if FAILS:
        print("QA-MSG-DESKTOP: FAILURES ->", ", ".join(FAILS))
    else:
        print("QA-MSG-DESKTOP: ALL PASS")
    for k, v in R.items():
        print(f"  {k}: {v}")
finally:
    server.terminate()
sys.exit(1 if FAILS else 0)
