#!/usr/bin/env python3
"""Messages management + logged-out bridge QA (Jeff, 2026-11-07).

Part 1 — the "formerly SIGNL" bridge line must be VISIBLE in the
logged-out .topbar header (sign-in + landing): computed color must
differ from the paper topbar background it sits on.

Part 2 — inbox management, creator + business:
- badges count unread THREADS from thread state: opening a
  conversation clears its alert (the stuck-alert root cause —
  notes alone used to drive the badge and nothing marked them
  read on open);
- mark as read without opening; mark as unread brings it back;
- delete hides the conversation; a new incoming message brings
  it back;
- folders: create (chip + via Move menu), move, filter views
  (All / Inbox / folder), rename, delete folder unfiles;
- mobile 390: open thread covers the list, "← Inbox" returns;
- desktop 1440 two-pane layout from 9ffbc23 stays intact (372px).

Part 3 — UNLAUNCHED-market regression (Jeff's live bug, 2026-11-07):
a Hampton Roads creator (market NOT in the live flags) holding the
Magpie team thread. The market-activation gate used to intercept
every per-user message-state route (read / unread / delete / move /
folder CRUD), because its POST exemption only recognised a send TO
the platform peer and PATCH/DELETE were never exempted — every
⋯-menu action answered with the "market has not launched yet" 403,
surfaced as a native alert, and nothing ever changed state. This
part exercises every ⋯ item from the list row AND the thread head
for the unlaunched creator (badge moving both ways, folders, delete
+ resurrection, open-clears-badge), asserts NO alert dialog ever
appears, and runs the full state matrix over the API for an
unlaunched-market business. The person-to-person gates must stay:
the unlaunched creator still cannot send to, or open, a
person-to-person thread.
Chromium runs through the local relay with loopback bypassed.
"""
import os, sys, subprocess, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.expanduser("~/workspace/signl-app")
OUT = os.path.expanduser("~/workspace/research_notes/signl-msg-manage-qa-2026-11-07")
os.makedirs(OUT, exist_ok=True)
PORT = 9089
BASE = f"http://127.0.0.1:{PORT}"
tmp = tempfile.mkdtemp(prefix="signl-msgmgmt-qa-")
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
// Part 3 fixtures: Hampton Roads is NOT in config:markets flags
// below, so both of these users live in an unlaunched market —
// Jeff's exact setup when every ⋯ action 403'd on the team thread.
putUser({ id: "hrqa", role: "creator", email: "harbor@msgqa.dev", name: "Harbor Creator", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Virginia Beach", createdAt: now, updatedAt: now,
  creator: { handle: "harborcreates", primaryPlatform: "instagram", followerCount: 4200, totalAudience: 4200, audienceStack: { instagram: 4200 }, categories: ["Food & Drink"], localAudiencePct: 71, tierBand: "Locals", profileComplete: true, publicPage: true, hasPhoto: false, bio: "Virginia Beach creator." } });
putUser({ id: "hrbizq", role: "business", email: "harborbiz@msgqa.dev", name: "Harbor Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Hampton Roads", city: "Virginia Beach", createdAt: now, updatedAt: now,
  business: { businessName: "Harbor Lights Kitchen", category: "Restaurant", plan: "self-service", planId: "self-service", accessState: "active", hasPhoto: false, about: "Kitchen." } });
const photoCr = fs.readFileSync(process.argv[3]);
data["photo:msgcr"] = { contentType: "image/jpeg", dataBase64: photoCr.toString("base64") };
const photoBiz = fs.readFileSync(process.argv[4]);
data["photo:msgbiz"] = { contentType: "image/png", dataBase64: photoBiz.toString("base64") };
data["config:markets"] = { flags: { "Nashville": true } };
const msg = (id, threadId, fromId, toId, body, createdAt, platform) => { data[`message:${id}`] = { id, threadId, fromId, toId, body, createdAt, ...(platform ? { platform: true } : {}) }; };
msg("m1", "msgcr__signl-team", "signl-team", "msgcr", "Quick news, the good kind: SIGNL is now Magpie. Same account, same founding spot, nothing to redo.", "2026-11-07T19:54:00.000Z", true);
msg("m2", "msgbiz__msgcr", "msgbiz", "msgcr", "Hi Carly — your last reel is exactly our room. Would you come in for a comped dinner for two?", "2026-11-07T16:10:00.000Z");
msg("m4", "msgbiz__msgcr", "msgbiz", "msgcr", "Perfect — see you at 11? The chef will set the counter seats.", "2026-11-07T18:05:00.000Z");
msg("m3", "msgbiz__msgcr", "msgcr", "msgbiz", "Thanks for thinking of me! Saturday works for us.", "2026-11-07T18:30:00.000Z");
msg("m5", "msgbiz2__msgcr", "msgbiz2", "msgcr", "Hello! We would love to host you at the bakery counter next week.", "2026-11-07T15:30:00.000Z");
// The legacy alert signal: unread message_received notes. Before
// this build these ALONE drove the badge and opening a thread
// never retired them — the stuck alert Jeff reported.
const note = (id, userId, threadId, fromId) => { data[`note:${userId}:${id}`] = { id, userId, kind: "message_received", text: "New message.", data: { threadId, fromId }, createdAt: "2026-11-07T19:55:00.000Z", readAt: null }; };
note("n1", "msgcr", "msgcr__signl-team", "signl-team");
note("n2", "msgcr", "msgbiz__msgcr", "msgbiz");
note("n3", "msgcr", "msgbiz2__msgcr", "msgbiz2");
note("nb1", "msgbiz", "msgbiz__msgcr", "msgcr");
msg("mh1", "hrqa__signl-team", "signl-team", "hrqa", "Welcome in — your founding spot in Hampton Roads is held, and we email you the moment it opens.", "2026-11-07T19:50:00.000Z", true);
msg("mh2", "hrqa__msgbiz", "msgbiz", "hrqa", "Hi Harbor — Salt & Stone would love to host you once Hampton Roads opens.", "2026-11-07T17:00:00.000Z");
msg("mh3", "hrbizq__hrqa", "hrqa", "hrbizq", "Thanks for the invite — excited for Hampton Roads to open.", "2026-11-07T18:00:00.000Z");
note("nh1", "hrqa", "hrqa__signl-team", "signl-team");
note("nh2", "hrqa", "hrqa__msgbiz", "msgbiz");
note("nhb1", "hrbizq", "hrbizq__hrqa", "hrqa");
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

        def badge(ctx):
            r = ctx.request.get(BASE + "/api/notifications")
            assert r.status == 200, f"notifications -> {r.status}"
            return r.json()["badges"]["messages"]

        def threads_api(ctx):
            r = ctx.request.get(BASE + "/api/messages")
            assert r.status == 200, f"messages -> {r.status}"
            return r.json()["threads"]

        def open_messages(page):
            page.goto(BASE + "/", wait_until="domcontentloaded")
            page.wait_for_function("() => { try { return typeof go === 'function' && !!state.user; } catch (e) { return false; } }", timeout=30000)
            page.evaluate("go('dashboard','Messages')")
            page.wait_for_selector("#thread-list-wrap .thread-item", timeout=30000)
            page.wait_for_timeout(700)

        prompt_answer = {"v": ""}
        def wire_dialogs(page):
            def on_dialog(d):
                if d.type == "prompt":
                    d.accept(prompt_answer["v"])
                else:
                    d.accept()
            page.on("dialog", on_dialog)

        # ============ PART 1: logged-out bridge line ============
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded")
        page.wait_for_function("() => { const el = document.querySelector('.topbar .formerly-line'); return !!el; }", timeout=30000)
        page.wait_for_timeout(800)
        for view in ["home", "signin", "forgot"]:
            if view != "home":
                page.evaluate(f"go('{view}')")
                page.wait_for_timeout(600)
            v = page.evaluate("""() => {
              const fl = document.querySelector('.topbar .formerly-line');
              const tb = document.querySelector('.topbar');
              if (!fl) return { found: false };
              const cs = getComputedStyle(fl), r = fl.getBoundingClientRect();
              return { found: true, text: fl.textContent.trim(), color: cs.color,
                       bg: getComputedStyle(tb).backgroundColor,
                       visible: fl.offsetParent !== null && r.width > 0 && r.height > 0 };
            }""")
            check(f"bridge visible logged-out {view}", v["found"] and v["visible"] and v["text"] == "formerly SIGNL" and v["color"] != v["bg"],
                  f"{v}")
            page.screenshot(path=os.path.join(OUT, f"p1-loggedout-{view}.png"))
        ctx.close()

        # ============ CREATOR DESKTOP 1440 ============
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "carly@msgqa.dev")
        check("creator badge starts at 3 unread threads", badge(ctx) == 3, f"badge={badge(ctx)}")
        page = ctx.new_page()
        wire_dialogs(page)
        open_messages(page)
        m = page.evaluate("""() => ({
          rows: document.querySelectorAll('.thread-item').length,
          dots: document.querySelectorAll('.thread-item .thread-dot').length,
          listW: document.querySelector('.msg-list-col').getBoundingClientRect().width,
          chips: [...document.querySelectorAll('#msg-folders .chip')].map(c => c.textContent.trim()),
          menus: document.querySelectorAll('.thread-item .thread-menu-btn').length
        })""")
        check("3 rows, 3 unread dots, 3 row menus", m["rows"] == 3 and m["dots"] == 3 and m["menus"] == 3, str(m))
        check("desktop list column still 372", abs(m["listW"] - 372) <= 4, f"{m['listW']:.0f}")
        check("folder chips All/Inbox/+New", m["chips"][:2] == ["All", "Inbox"] and any("New folder" in c for c in m["chips"]), str(m["chips"]))
        page.screenshot(path=os.path.join(OUT, "01-creator-inbox-desktop.png"))

        # open the business thread -> its alert clears at once
        page.click(".thread-item:has-text('Salt & Stone Kitchen')")
        page.wait_for_selector("#msg-list .msg", timeout=15000)
        page.wait_for_timeout(900)
        check("badge drops to 2 after opening a thread", badge(ctx) == 2, f"badge={badge(ctx)}")
        dot = page.evaluate("() => { const r = [...document.querySelectorAll('.thread-item')].find(x => x.textContent.includes('Salt & Stone')); return r ? !!r.querySelector('.thread-dot') : null; }")
        check("opened row dot cleared", dot is False, f"dot={dot}")
        page.screenshot(path=os.path.join(OUT, "02-creator-thread-open-desktop.png"))

        # mark as read without opening (Blue Door, via its menu)
        page.click(".thread-item:has-text('Blue Door Bakery') .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Mark as read')")
        page.wait_for_timeout(800)
        check("badge drops to 1 after mark-as-read", badge(ctx) == 1, f"badge={badge(ctx)}")

        # mark as unread brings the alert back (Salt & Stone)
        page.click(".thread-item:has-text('Salt & Stone Kitchen') .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Mark as unread')")
        page.wait_for_timeout(800)
        check("badge back to 2 after mark-as-unread", badge(ctx) == 2, f"badge={badge(ctx)}")
        # and opening it again reads it again
        page.click(".thread-item:has-text('Salt & Stone Kitchen')")
        page.wait_for_selector("#msg-list .msg", timeout=15000)
        page.wait_for_timeout(900)
        check("badge back to 1 after re-open", badge(ctx) == 1, f"badge={badge(ctx)}")

        # ---- folders ----
        prompt_answer["v"] = "Bookings"
        page.click("#msg-folders .chip:has-text('New folder')")
        page.wait_for_timeout(900)
        chips = page.evaluate("() => [...document.querySelectorAll('#msg-folders .chip')].map(c => c.textContent.trim())")
        check("folder chip created + selected", "Bookings" in chips, str(chips))
        empty_txt = page.evaluate("() => (document.querySelector('#thread-list-wrap .ec-s') || {}).textContent || ''")
        check("new folder view is empty with honest copy", "Nothing is filed" in empty_txt, empty_txt[:60])
        page.click("#msg-folders .chip:has-text('All')")
        page.wait_for_timeout(500)
        # move Blue Door into Bookings via its row menu
        page.click(".thread-item:has-text('Blue Door Bakery') .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Move to folder')")
        page.wait_for_selector("#msg-sheet .sheet-row:has-text('Bookings')", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Bookings')")
        page.wait_for_timeout(800)
        th = {t["otherId"]: t for t in threads_api(ctx)}
        check("API: Blue Door filed in a folder", bool(th["msgbiz2"].get("folderId")), str(th["msgbiz2"].get("folderId")))
        page.click("#msg-folders .chip:has-text('Bookings')")
        page.wait_for_timeout(500)
        rows = page.evaluate("() => [...document.querySelectorAll('.thread-item')].map(r => r.textContent)")
        check("folder view shows only Blue Door", len(rows) == 1 and "Blue Door" in rows[0], str(len(rows)))
        page.click("#msg-folders .chip:has-text('Inbox')")
        page.wait_for_timeout(500)
        rows = page.evaluate("() => [...document.querySelectorAll('.thread-item')].map(r => r.textContent)")
        check("Inbox view hides filed, keeps unfiled", len(rows) == 2 and not any("Blue Door" in r for r in rows), str(len(rows)))
        page.screenshot(path=os.path.join(OUT, "03-creator-folders-desktop.png"))

        # rename the folder
        page.click("#msg-folders .chip:has-text('Bookings')")
        page.wait_for_timeout(400)
        prompt_answer["v"] = "Clients"
        page.click(".msg-folder-admin button:has-text('Rename')")
        page.wait_for_timeout(900)
        chips = page.evaluate("() => [...document.querySelectorAll('#msg-folders .chip')].map(c => c.textContent.trim())")
        check("folder renamed to Clients", "Clients" in chips and "Bookings" not in chips, str(chips))

        # delete the folder -> conversations unfiled, not deleted
        page.click(".msg-folder-admin button:has-text('Delete folder')")
        page.wait_for_timeout(900)
        th = {t["otherId"]: t for t in threads_api(ctx)}
        check("folder deleted; Blue Door unfiled not deleted", len(th) == 3 and not th["msgbiz2"].get("folderId"), f"threads={len(th)}")

        # ---- delete a conversation, then it resurrects ----
        page.click("#msg-folders .chip:has-text('All')")
        page.wait_for_timeout(400)
        page.click(".thread-item:has-text('Blue Door Bakery') .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Delete conversation')")
        page.wait_for_timeout(900)
        th = threads_api(ctx)
        check("deleted conversation leaves the inbox", len(th) == 2 and all(t["otherId"] != "msgbiz2" for t in th), f"threads={len(th)}")
        # the other side writes again -> it comes back, unread
        ctx2 = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx2, "blue@msgqa.dev")
        r = ctx2.request.post(BASE + "/api/messages", data={"toUserId": "msgcr", "body": "One more thing — the counter seats are yours Saturday if you want them."})
        check("business follow-up sent", r.status == 201, f"status={r.status}")
        ctx2.close()
        page.evaluate("go('dashboard','Messages')")
        page.wait_for_selector("#thread-list-wrap .thread-item", timeout=30000)
        page.wait_for_timeout(800)
        th = {t["otherId"]: t for t in threads_api(ctx)}
        check("conversation resurrected by new message, unread", "msgbiz2" in th and th["msgbiz2"]["unread"] is True, str(th.get("msgbiz2", {}).get("unread")))
        check("badge counts resurrected thread (2)", badge(ctx) == 2, f"badge={badge(ctx)}")
        page.screenshot(path=os.path.join(OUT, "04-creator-resurrected-desktop.png"))
        ctx.close()

        # ============ CREATOR MOBILE 390 ============
        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        login(ctx, "carly@msgqa.dev")
        page = ctx.new_page()
        wire_dialogs(page)
        open_messages(page)
        page.click(".thread-item:has-text('Salt & Stone Kitchen')")
        page.wait_for_selector("#msg-list .msg", timeout=15000)
        page.wait_for_timeout(600)
        mm = page.evaluate("""() => {
          const lc = document.querySelector('.msg-list-col');
          const back = document.querySelector('.msg-back');
          return { listHidden: getComputedStyle(lc).display === 'none',
                   backVisible: !!back && back.offsetParent !== null,
                   backText: back ? back.textContent.trim() : '',
                   toolsHidden: getComputedStyle(document.querySelector('.msg-tools')).display === 'none' };
        }""")
        check("mobile: open thread covers list, tools tucked away", mm["listHidden"] and mm["toolsHidden"], str(mm))
        check("mobile: ← Inbox control visible", mm["backVisible"] and "Inbox" in mm["backText"], str(mm))
        page.screenshot(path=os.path.join(OUT, "05-creator-thread-mobile.png"))
        page.click(".msg-back")
        page.wait_for_selector("#thread-list-wrap .thread-item", timeout=15000)
        page.wait_for_timeout(600)
        back = page.evaluate("() => getComputedStyle(document.querySelector('.msg-list-col')).display !== 'none' && document.querySelectorAll('.thread-item').length")
        check("mobile: ← Inbox returns to the list", back == 3, f"rows={back}")
        page.screenshot(path=os.path.join(OUT, "06-creator-inbox-mobile.png"))
        ctx.close()

        # ============ PART 3: UNLAUNCHED MARKET (Hampton Roads) ============
        # Jeff's exact case: a creator in a market that has not
        # launched, Magpie team thread in her inbox. Every per-user
        # state action used to answer with the launch-gate 403.
        # Dialogs are RECORDED here, not just accepted: a native
        # alert firing at all is a failure.
        hr_dialogs = []
        def wire_recorder(page):
            def on_dialog(d):
                hr_dialogs.append({"type": d.type, "message": d.message})
                if d.type == "prompt":
                    d.accept(prompt_answer["v"])
                else:
                    d.accept()
            page.on("dialog", on_dialog)

        ctx = b.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
        login(ctx, "harbor@msgqa.dev")
        check("HR creator badge starts at 2", badge(ctx) == 2, f"badge={badge(ctx)}")
        page = ctx.new_page()
        wire_recorder(page)
        open_messages(page)
        rows = page.evaluate("() => [...document.querySelectorAll('.thread-item')].map(r => r.textContent)")
        check("HR inbox lists team + business threads", len(rows) == 2, f"rows={len(rows)}")
        page.screenshot(path=os.path.join(OUT, "08-hr-inbox-mobile.png"))

        # open the team thread -> the badge clears on open
        page.click(".thread-item:has-text('Magpie')")
        page.wait_for_selector("#msg-list .msg", timeout=15000)
        page.wait_for_timeout(900)
        check("HR badge drops to 1 after opening team thread", badge(ctx) == 1, f"badge={badge(ctx)}")
        page.screenshot(path=os.path.join(OUT, "09-hr-team-thread-mobile.png"))

        # thread-head menu: mark unread brings it back, mark read clears it
        page.click(".thread-head .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Mark as unread')")
        page.wait_for_timeout(800)
        check("HR badge back to 2 after thread-head mark-unread", badge(ctx) == 2, f"badge={badge(ctx)}")
        page.click(".thread-head .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Mark as read')")
        page.wait_for_timeout(800)
        check("HR badge back to 1 after thread-head mark-read", badge(ctx) == 1, f"badge={badge(ctx)}")

        # back to the list; the business thread's row menu marks it read
        page.click(".msg-back")
        page.wait_for_selector("#thread-list-wrap .thread-item", timeout=15000)
        page.wait_for_timeout(500)
        page.click(".thread-item:has-text('Salt & Stone') .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Mark as read')")
        page.wait_for_timeout(800)
        check("HR badge to 0 after row-menu mark-read", badge(ctx) == 0, f"badge={badge(ctx)}")

        # move the team thread into a brand-new folder from its row menu
        prompt_answer["v"] = "Harbor"
        page.click(".thread-item:has-text('Magpie') .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Move to folder')")
        page.wait_for_selector("#msg-sheet .sheet-row:has-text('New folder')", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('New folder')")
        page.wait_for_timeout(1000)
        th = {t["otherId"]: t for t in threads_api(ctx)}
        check("HR team thread filed in new folder", bool(th["signl-team"].get("folderId")), str(th["signl-team"].get("folderId")))
        chips = page.evaluate("() => [...document.querySelectorAll('#msg-folders .chip')].map(c => c.textContent.trim())")
        check("HR folder chip present", "Harbor" in chips, str(chips))
        page.click("#msg-folders .chip:has-text('Harbor')")
        page.wait_for_timeout(500)
        rows = page.evaluate("() => [...document.querySelectorAll('.thread-item')].map(r => r.textContent)")
        check("HR folder view shows only the team thread", len(rows) == 1 and "Magpie" in rows[0], f"rows={len(rows)}")
        page.click("#msg-folders .chip:has-text('All')")
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(OUT, "10-hr-folders-mobile.png"))

        # delete the business thread from its row menu, then it resurrects
        page.click(".thread-item:has-text('Salt & Stone') .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Delete conversation')")
        page.wait_for_timeout(900)
        th = threads_api(ctx)
        check("HR deleted business thread leaves inbox", len(th) == 1 and th[0]["otherId"] == "signl-team", f"threads={len(th)}")
        ctxB = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctxB, "owner@msgqa.dev")
        r = ctxB.request.post(BASE + "/api/messages", data={"toUserId": "hrqa", "body": "Following up, Harbor — the first table is yours when we open."})
        check("HR resurrection send from live-market business", r.status == 201, f"status={r.status}")
        ctxB.close()
        page.evaluate("go('dashboard','Messages')")
        page.wait_for_selector("#thread-list-wrap .thread-item", timeout=30000)
        page.wait_for_timeout(800)
        th = {t["otherId"]: t for t in threads_api(ctx)}
        check("HR business thread resurrected unread", "msgbiz" in th and th["msgbiz"]["unread"] is True, str(th.get("msgbiz", {}).get("unread")))
        check("HR badge counts resurrected thread (1)", badge(ctx) == 1, f"badge={badge(ctx)}")

        # the whole point of the fix: no alert ever fired
        alerts = [d for d in hr_dialogs if d["type"] == "alert"]
        launched = [d for d in hr_dialogs if "has not launched" in d["message"]]
        check("HR: no native alert dialogs in any menu action", not alerts and not launched, str(hr_dialogs))

        # gates that must STAY for the unlaunched creator
        r = ctx.request.post(BASE + "/api/messages", data={"toUserId": "msgbiz", "body": "hello?"})
        check("HR person-to-person send still gated (403)", r.status == 403, f"status={r.status}")
        r = ctx.request.get(BASE + "/api/messages?with=msgbiz")
        check("HR person-to-person thread read still gated (403)", r.status == 403, f"status={r.status}")
        r = ctx.request.get(BASE + "/api/messages?with=signl-team")
        check("HR platform thread read still allowed (200)", r.status == 200, f"status={r.status}")
        ctx.close()

        # unlaunched-market BUSINESS: the full state matrix over the API
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "harborbiz@msgqa.dev")
        check("HR business badge starts at 1", badge(ctx) == 1, f"badge={badge(ctx)}")
        r = ctx.request.post(BASE + "/api/messages/read", data={"otherId": "hrqa"})
        check("HR business mark read 200, badge 0", r.status == 200 and badge(ctx) == 0, f"status={r.status} badge={badge(ctx)}")
        r = ctx.request.post(BASE + "/api/messages/unread", data={"otherId": "hrqa"})
        check("HR business mark unread 200, badge 1", r.status == 200 and badge(ctx) == 1, f"status={r.status} badge={badge(ctx)}")
        r = ctx.request.post(BASE + "/api/messages/folders", data={"name": "VIP"})
        fid = r.json()["folder"]["id"] if r.status == 201 else None
        check("HR business folder create 201", r.status == 201, f"status={r.status}")
        r = ctx.request.post(BASE + "/api/messages/move", data={"otherId": "hrqa", "folderId": fid})
        check("HR business move 200", r.status == 200, f"status={r.status}")
        r = ctx.request.patch(BASE + f"/api/messages/folders/{fid}", data={"name": "VIPs"})
        check("HR business folder rename 200", r.status == 200, f"status={r.status}")
        r = ctx.request.delete(BASE + f"/api/messages/folders/{fid}")
        check("HR business folder delete 200", r.status == 200, f"status={r.status}")
        r = ctx.request.post(BASE + "/api/messages/delete", data={"otherId": "hrqa"})
        check("HR business conversation delete 200", r.status == 200, f"status={r.status}")
        ctx.close()

        # ============ BUSINESS DESKTOP (parity) ============
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        login(ctx, "owner@msgqa.dev")
        check("business badge starts at 1", badge(ctx) == 1, f"badge={badge(ctx)}")
        page = ctx.new_page()
        wire_dialogs(page)
        open_messages(page)
        dot = page.evaluate("() => { const r = document.querySelector('.thread-item'); return r ? !!r.querySelector('.thread-dot') : null; }")
        check("business sees creator thread unread", dot is True, f"dot={dot}")
        page.click(".thread-item:has-text('Carly Creator')")
        page.wait_for_selector("#msg-list .msg", timeout=15000)
        page.wait_for_timeout(900)
        check("business badge clears on open", badge(ctx) == 0, f"badge={badge(ctx)}")
        # create + move via the row menu's New folder path
        prompt_answer["v"] = "VIP"
        page.click(".thread-item:has-text('Carly Creator') .thread-menu-btn")
        page.wait_for_selector("#msg-sheet .sheet-row", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('Move to folder')")
        page.wait_for_selector("#msg-sheet .sheet-row:has-text('New folder')", timeout=10000)
        page.click("#msg-sheet .sheet-row:has-text('New folder')")
        page.wait_for_timeout(1000)
        th = threads_api(ctx)
        check("business: folder created via menu + thread filed", len(th) == 1 and bool(th[0].get("folderId")), str(th))
        chips = page.evaluate("() => [...document.querySelectorAll('#msg-folders .chip')].map(c => c.textContent.trim())")
        check("business: VIP chip present", "VIP" in chips, str(chips))
        page.screenshot(path=os.path.join(OUT, "07-business-folders-desktop.png"))
        ctx.close()

    print("RESULTS:")
    for k, v in R.items():
        print(f"  {k}: {v}")
    print("FAILS:", FAILS if FAILS else "none")
finally:
    server.terminate()
