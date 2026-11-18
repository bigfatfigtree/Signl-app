#!/usr/bin/env python3
"""Build -138 rendered QA: new admin rooms, teammate persona,
unlisted creator, and the 390px compare-tray / overflow proof."""
import json, os, sys
sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:9016"
OUT = os.path.expanduser("~/workspace/signl-app/.qa138/shots")
os.makedirs(OUT, exist_ok=True)
PW = "<MASKED_SECRET_001>"
R = {"checks": [], "errors": []}

def check(name, cond, extra=""):
    R["checks"].append({"name": name, "ok": bool(cond), "extra": str(extra)[:300]})
    print(("  ok " if cond else "FAIL ") + name + ("" if cond else " :: " + str(extra)[:300]))

def login(pg, email, password):
    pg.goto(BASE + "/", wait_until="networkidle")
    ein = pg.locator("input[type=email], input[name=email], input#login-email").first
    if not ein.is_visible():
        si = pg.get_by_text("Sign in", exact=True).first
        if si.count() and si.is_visible():
            si.click(); pg.wait_for_timeout(900)
    ein = pg.locator("input[type=email], input[name=email], input#login-email").first
    ein.fill(email)
    pg.locator("input[type=password]").first.fill(password)
    pg.locator("button[type=submit]").first.click()
    pg.wait_for_timeout(2600)

def go_tab(pg, tab):
    pg.evaluate(f"go('dashboard', '{tab}')")
    pg.wait_for_timeout(1400)

def overflow(pg):
    return pg.evaluate("() => document.scrollingElement.scrollWidth")

def shot(pg, name):
    pg.screenshot(path=os.path.join(OUT, name), full_page=False)

def body_text(pg):
    return pg.inner_text("body")

TRAY_JS = """() => {
  const tray = document.querySelector('.shelf-tray');
  if (!tray) return { present: false };
  const out = { present: true, cols: [], violations: [] };
  for (const col of tray.querySelectorAll('.shelf-tray-col')) {
    const cr = col.getBoundingClientRect();
    out.cols.push({ name: (col.querySelector('.shelf-tray-name')||{}).textContent || '', left: cr.left, right: cr.right, width: cr.width });
    for (const el of col.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < cr.left - 1 || r.right > cr.right + 1) {
        out.violations.push({ cls: el.className && el.className.baseVal !== undefined ? '' : String(el.className), text: (el.textContent || '').slice(0, 40), left: r.left, right: r.right, colLeft: cr.left, colRight: cr.right });
      }
    }
  }
  return out;
}"""

ESCAPE_JS = """(rootSel) => {
  const root = document.querySelector(rootSel);
  if (!root) return { present: false, violations: [] };
  const violations = [];
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' && cs.whiteSpace !== 'nowrap') {
        violations.push({ cls: String(el.className).slice(0, 40), text: (el.textContent || '').slice(0, 40), sw: el.scrollWidth, cw: el.clientWidth });
      }
    }
  }
  return { present: true, violations: violations.slice(0, 12), count: violations.length };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(channel="chromium")
    UA_M = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")

    # ================= MOBILE 390px =================
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                        is_mobile=True, has_touch=True, user_agent=UA_M, ignore_https_errors=True)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: R["errors"].append(f"mobile PAGEERROR: {e}"))

    # ---- business: the compare tray ----
    login(pg, "biz@qa138.dev", PW)
    go_tab(pg, "Discover")
    pg.wait_for_timeout(1200)
    tray = pg.evaluate(TRAY_JS)
    check("mobile: compare tray renders with 3 saved creators", tray.get("present") and len(tray.get("cols", [])) == 3, json.dumps(tray)[:240])
    check("mobile: no tray element crosses its column border", tray.get("present") and not tray.get("violations"), json.dumps(tray.get("violations"))[:300])
    check("mobile: Find creators page has zero horizontal overflow", overflow(pg) <= 391, overflow(pg))
    shot(pg, "m-business-find-tray.png")
    tiles = pg.evaluate(ESCAPE_JS, ".shelf-grid")
    check("mobile: creator tiles have no escaping text", tiles.get("present") and tiles.get("count", 0) == 0, json.dumps(tiles)[:300])
    # open the first creator PDP
    pg.evaluate("document.querySelector('.shelf-tile, .shelf-card')?.click()")
    pg.wait_for_timeout(1500)
    check("mobile: creator page has zero horizontal overflow", overflow(pg) <= 391, overflow(pg))
    t = body_text(pg)
    check("mobile: creator page shows the local % hero with the spelled-out count", "%" in t and "neighbors" in t, t[:200])
    shot(pg, "m-creator-pdp.png")
    go_tab(pg, "Favorites")
    check("mobile: Favorites has zero horizontal overflow", overflow(pg) <= 391, overflow(pg))
    shot(pg, "m-business-favorites.png")
    go_tab(pg, "Home")
    check("mobile: business Home has zero horizontal overflow", overflow(pg) <= 391, overflow(pg))
    t = body_text(pg)
    check("mobile: business Home leads with Sig + highlights + next steps", "Sig" in t and "quick highlights" in t.lower(), t[:160])
    shot(pg, "m-business-home.png")

    # ---- unlisted creator ----
    pg.evaluate("signOut()")
    pg.wait_for_timeout(1200)
    login(pg, "fran@qa138.dev", PW)
    t = body_text(pg)
    check("unlisted creator home: building/early framing present", "building" in t.lower() and ("early" in t.lower()), t[:400])
    check("mobile: unlisted creator Home has zero horizontal overflow", overflow(pg) <= 391, overflow(pg))
    shot(pg, "m-unlisted-home.png")
    go_tab(pg, "Status")
    pg.wait_for_timeout(1000)
    t = body_text(pg)
    check("unlisted Status: 'Fargo is building — and you're early' panel", "is building" in t and "first pick" in t, t[:300])
    shot(pg, "m-unlisted-status.png")

    # ---- admin mobile spot checks ----
    pg.evaluate("signOut()")
    pg.wait_for_timeout(1200)
    login(pg, "admin@qa138.dev", "<MASKED_SECRET_004>")
    go_tab(pg, "Markets")
    pg.wait_for_timeout(1200)
    check("mobile: admin Markets zero overflow", overflow(pg) <= 391, overflow(pg))
    t = body_text(pg)
    check("mobile: Markets demand section present with Flagtown-style rows or empty state", "Demand in cities" in t, t[-400:])
    go_tab(pg, "Automations")
    pg.wait_for_timeout(1200)
    check("mobile: Automations zero overflow", overflow(pg) <= 391, overflow(pg))
    t = body_text(pg)
    check("mobile: Automations lists the catalogue with Always on critical rows", "Always on" in t and "Connections" in t, t[:200])
    shot(pg, "m-admin-automations.png")
    ctx.close()

    # ================= DESKTOP =================
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: R["errors"].append(f"desktop PAGEERROR: {e}"))
    pg.on("response", lambda r: R["errors"].append(f"HTML-AS-SCRIPT: {r.url}") if (r.request.resource_type == "script" and "text/html" in (r.headers.get("content-type") or "")) else None)
    login(pg, "admin@qa138.dev", "<MASKED_SECRET_004>")
    try:
        pg.wait_for_function("() => document.body.innerText.toLowerCase().includes('quick highlights')", timeout=9000)
    except Exception:
        pass
    t = body_text(pg)
    check("desktop: admin Home renders Sig hero + highlights", "quick highlights" in t.lower(), t[:160])
    shot(pg, "d-admin-home.png")
    for tab, needles in [
        ("Markets", ["Demand in cities", "Fargo"]),
        ("Automations", ["Connections", "Twilio", "Always on"]),
        ("Templates", ["Your templates", "New template"]),
        ("Marketing", ["Write a campaign", "hello@joinsignl.com", "In-app message (creators)"]),
        ("Social", ["Instagram", "followers"]),
        ("Team", ["Invite a teammate", "Role templates"]),
        ("Learn", ["Learn studio", "The magazine (50)"]),
        ("Stats", ["Website", "aren't connected yet"]),
    ]:
        go_tab(pg, tab)
        pg.wait_for_timeout(900)
        t = body_text(pg)
        missing = [n for n in needles if n not in t]
        check(f"desktop: {tab} room renders its content", not missing, f"missing: {missing}")
        check(f"desktop: {tab} zero horizontal overflow", overflow(pg) <= 1441, overflow(pg))
        shot(pg, f"d-admin-{tab.lower()}.png")
    # message by market: the demand city is selectable, counts live, SMS honest
    go_tab(pg, "Marketing")
    pg.wait_for_timeout(900)
    opts = pg.evaluate("() => [...document.querySelectorAll('#a138-mk-segment option')].map(o => o.textContent)")
    check("desktop: audience builder offers the unlisted demand city (Fargo) as a segment",
          any("Fargo" in o and "not a launch market yet" in o for o in opts), str(opts)[:260])
    idx = pg.evaluate("() => [...document.querySelectorAll('#a138-mk-segment option')].findIndex(o => o.textContent.includes('Fargo'))")
    if idx >= 0:
        pg.select_option("#a138-mk-segment", index=idx)
        pg.wait_for_timeout(1100)
        sc = pg.inner_text("#a138-mk-segcount")
        check("desktop: Fargo segment count resolves live to the approved Fargo creator", sc.startswith("That list is 1 people"), sc)
    pg.locator('input[name="a138-mk-channel"][value="sms"]').click()
    pg.wait_for_timeout(400)
    note = pg.evaluate("() => { const n = document.getElementById('a138-mk-smsnote'); return { display: n.style.display, text: n.textContent }; }")
    check("desktop: picking Text message shows the honest Twilio state, subject hidden",
          note["display"] != "none" and "Texts switch on when Twilio finishes connecting" in note["text"], str(note)[:220])
    shot(pg, "d-admin-marketing-sms.png")
    # teammate persona
    pg.evaluate("signOut()")
    pg.wait_for_timeout(1200)
    login(pg, "tm@qa138.dev", PW)
    nav = pg.evaluate("""() => {
      const items = [...document.querySelectorAll('.rail-item, .bn-item, [class*=rail] a, [class*=rail] button')].map(e => e.textContent.trim());
      return items;
    }""")
    rail_txt = body_text(pg)
    navset = {x for x in nav if x}
    check("teammate: rail hides Team/Marketing/Automations (not their rooms)",
          "Team" not in navset and "Marketing" not in navset and "Automations" not in navset and "Stats" not in navset and "Review" in navset, str(nav)[:300])
    check("teammate: no page errors in their session", not R["errors"], str(R["errors"])[:200])
    shot(pg, "d-teammate-home.png")
    ctx.close()

    # business desktop tray
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
    pg = ctx.new_page()
    login(pg, "biz@qa138.dev", PW)
    go_tab(pg, "Discover")
    pg.wait_for_timeout(1200)
    tray = pg.evaluate(TRAY_JS)
    check("desktop: tray renders, no element crosses its column", tray.get("present") and not tray.get("violations"), json.dumps(tray.get("violations"))[:240])
    shot(pg, "d-business-find-tray.png")
    ctx.close()
    b.close()

fails = [c for c in R["checks"] if not c["ok"]]
print(f"\nQA: {len(R['checks']) - len(fails)}/{len(R['checks'])} passed; page errors: {len(R['errors'])}")
for e in R["errors"][:6]:
    print("ERR:", e[:220])
json.dump(R, open(os.path.join(OUT, "..", "qa-results.json"), "w"), indent=1)
