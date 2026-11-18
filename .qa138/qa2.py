import sys, os, json, time
sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:9016"
OUT = os.path.expanduser("~/workspace/signl-app/.qa138/shots")
os.makedirs(OUT, exist_ok=True)
results = []
def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail and not ok else ""))

def login(pg, email, pw):
    pg.goto(BASE + "/", wait_until="networkidle")
    ein = pg.locator("input[type=email]").first
    if not ein.is_visible():
        si = pg.get_by_text("Sign in", exact=True).first
        if si.count() and si.is_visible():
            si.click(); pg.wait_for_timeout(700)
    t0 = time.time()
    pg.locator("input[type=email]").first.fill(email)
    pg.locator("input[type=password]").first.fill(pw)
    pg.locator("button[type=submit]").first.click()
    return t0

def wait_text(pg, needle, timeout_ms=20000):
    t0 = time.time()
    while (time.time() - t0) * 1000 < timeout_ms:
        if pg.evaluate("(n) => document.body.innerText.includes(n)", needle):
            return (time.time() - t0) * 1000
        pg.wait_for_timeout(200)
    return None

def overflow_ok(pg):
    return pg.evaluate("() => document.scrollingElement.scrollWidth <= window.innerWidth + 1")

with sync_playwright() as p:
    b = p.chromium.launch(channel="chromium")

    # ---------- DESKTOP ----------
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:100]))

    # Business: white home + takeover Discover
    login(pg, "biz@qa138.dev", "<MASKED_SECRET_001>")
    ms = wait_text(pg, "Tray Test Tacos")
    check("biz home first paint (no click)", ms is not None, f"{ms}ms")
    bg = pg.evaluate("() => getComputedStyle(document.body).backgroundColor")
    check("app background is pure white", bg == "rgb(255, 255, 255)", bg)
    pg.screenshot(path=f"{OUT}/d-biz-home-white.png")
    pg.evaluate("go('dashboard','Discover')")
    pg.wait_for_timeout(2200)
    tk = pg.evaluate("""() => ({
      takeover: document.body.classList.contains('shop-takeover'),
      back: [...document.querySelectorAll('.takeover-bar button')].some(x => x.textContent.includes('Back to dashboard')),
      railHidden: (() => { const r = document.getElementById('rail'); return !r || getComputedStyle(r).display === 'none'; })(),
      wishlist: !!document.getElementById('biz-wishlist'),
      railGroups: [...document.querySelectorAll('#disc-rail .df-label')].map(e => e.textContent.trim()),
      searchInputs: document.querySelectorAll('.shop-searchrow input[type=search]').length,
      pillWall: document.querySelectorAll('.cat-chips .dcat-chip').length,
    })""")
    check("discover: full-screen takeover on", tk["takeover"])
    check("discover: Back to dashboard pinned", tk["back"])
    check("discover: dashboard rail hidden in takeover", tk["railHidden"])
    check("discover: wishlist form OUT of browse", not tk["wishlist"])
    check("discover: rail groups labelled", all(g in tk["railGroups"] for g in ["Category", "Must-haves", "How you want to book", "Their rate", "Their audience lives here"]), tk["railGroups"])
    check("discover: exactly one search input in the search row", tk["searchInputs"] == 1, tk["searchInputs"])
    check("discover: no wrapped pill wall (chips live in one scroll row)", tk["pillWall"] == 0, tk["pillWall"])
    check("discover: zero horizontal overflow", overflow_ok(pg))
    pg.screenshot(path=f"{OUT}/d-biz-discover-takeover.png")
    pg.evaluate("go('dashboard','Favorites')")
    pg.wait_for_timeout(1800)
    check("saved: wishlist lives under Saved", pg.evaluate("() => !!document.getElementById('biz-wishlist')"))
    pg.evaluate("signOut()"); pg.wait_for_timeout(900)

    # Creator: Find Offers mirror
    login(pg, "alpha@qa138.dev", "<MASKED_SECRET_001>")
    ms = wait_text(pg, "Hi, Alpha")
    check("creator home first paint (no click)", ms is not None, f"{ms}ms")
    pg.evaluate("go('dashboard','Find Offers')")
    pg.wait_for_timeout(2200)
    fo = pg.evaluate("""() => {
      const cards = [...document.querySelectorAll('.mirror-card')];
      const lead = document.querySelector('.mirror-lead');
      const grid = document.querySelector('.mirror-grid');
      const groups = [...document.querySelectorAll('#fo-rail .df-label')].map(e => e.textContent.trim());
      const fallbackBad = [...document.querySelectorAll('.mirror-cover-fallback')].some(e => e.textContent.trim() === '?');
      const seg = document.querySelector('.fo-seg');
      return { n: cards.length, leadW: lead ? lead.getBoundingClientRect().width : 0, gridW: grid ? grid.getBoundingClientRect().width : 0,
        groups, fallbackBad, hasSegBox: !!seg,
        counts: [...document.querySelectorAll('#fo-rail .rr-count')].map(e => e.textContent.trim()) };
    }""")
    check("find offers: 3 seeded offers render", fo["n"] == 3, fo["n"])
    check("find offers: lead card spans the results width", fo["leadW"] > 0 and abs(fo["leadW"] - fo["gridW"]) <= 4, f"lead {fo['leadW']} grid {fo['gridW']}")
    check("find offers: full filter groups present", all(g in fo["groups"] for g in ["The offer", "Category", "Distance from you", "Good to know"]), fo["groups"])
    check("find offers: no bare '?' fallback tile", not fo["fallbackBad"])
    check("find offers: cramped segment box is gone", not fo["hasSegBox"])
    check("find offers: rail counts render", len(fo["counts"]) >= 6 and all(c != "" for c in fo["counts"]), fo["counts"])
    pg.screenshot(path=f"{OUT}/d-creator-findoffers.png")
    # narrowing: category -> Restaurant (2), kind -> paid (1), distance -> Same neighborhood (2), search -> brunch (1)
    def fo_count():
        return pg.evaluate("() => document.querySelectorAll('.mirror-card').length")
    pg.evaluate("""() => { const r = [...document.querySelectorAll('input[name=fo-cat]')].find(x => x.closest('label').textContent.includes('Restaurant')); if (r) r.click(); }""")
    pg.wait_for_timeout(700)
    check("filter narrows: category Restaurant -> 2", fo_count() == 2, fo_count())
    pg.evaluate("foClearAll()"); pg.wait_for_timeout(700)
    pg.evaluate("""() => { const r = [...document.querySelectorAll('input[name=fo-kind]')].find(x => x.closest('label').textContent.includes('Paid post')); if (r) r.click(); }""")
    pg.wait_for_timeout(700)
    check("filter narrows: kind Paid post -> 1", fo_count() == 1, fo_count())
    pg.evaluate("foClearAll()"); pg.wait_for_timeout(700)
    pg.evaluate("""() => { const r = [...document.querySelectorAll('input[name=fo-dist]')].find(x => x.closest('label').textContent.includes('Same neighborhood')); if (r) r.click(); }""")
    pg.wait_for_timeout(700)
    check("filter narrows: distance Same neighborhood -> 2", fo_count() == 2, fo_count())
    pg.evaluate("foClearAll()"); pg.wait_for_timeout(700)
    pg.evaluate("""() => { const q = document.getElementById('fo-q'); q.focus(); q.value='brunch'; foQInput(q); }""")
    pg.wait_for_timeout(900)
    check("filter narrows: search 'brunch' -> 1", fo_count() == 1, fo_count())
    check("find offers: zero horizontal overflow", overflow_ok(pg))
    pg.evaluate("signOut()"); pg.wait_for_timeout(900)

    # Admin: first paint timing + tables
    t0 = login(pg, "admin@qa138.dev", "<MASKED_SECRET_004>")
    ms = wait_text(pg, "QUICK HIGHLIGHTS")
    check("admin home: highlights paint with no click", ms is not None, f"{ms}ms")
    steps_ms = wait_text(pg, "NEXT STEPS")
    check("admin home: next steps paint with no click", steps_ms is not None, f"{steps_ms}ms")
    greet = pg.evaluate("() => { const g = document.querySelector('.hg-hi'); return g ? g.textContent : ''; }")
    check("admin home: greeting painted immediately", "Good" in greet, greet)
    pg.evaluate("go('dashboard','Applications')")
    pg.wait_for_timeout(2500)
    pg.evaluate("""() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'List'); if (b) b.click(); }""")
    pg.wait_for_timeout(1500)
    tab = pg.evaluate("""() => {
      const t = document.querySelector('.apps-table');
      if (!t) return { found: false };
      const wrap = t.closest('.table-wrap');
      const tr = t.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      let clipped = 0, cells = 0; const clippedInfo = [];
      t.querySelectorAll('td').forEach(td => { cells++; if (td.scrollWidth > td.clientWidth + 1) { clipped++; if (clippedInfo.length < 3) clippedInfo.push({ sw: td.scrollWidth, cw: td.clientWidth, txt: td.textContent.slice(0, 60) }); } });
      const details = t.querySelectorAll('td')[3];
      return { found: true, fits: tr.right <= wr.right + 1 && tr.left >= wr.left - 1, clipped, cells, clippedInfo,
        detailText: details ? details.textContent.length : 0, detailFull: details ? !details.textContent.includes('…') : false };
    }""")
    check("decided/pending table: apps-table renders", tab["found"])
    if tab["found"]:
        check("table fits inside its card (desktop)", tab["fits"], tab)
        check("no clipped table cells (desktop)", tab["clipped"] == 0, f"{tab['clipped']}/{tab['cells']}")
    check("admin: zero horizontal overflow", overflow_ok(pg))
    pg.screenshot(path=f"{OUT}/d-admin-applications-table.png", full_page=False)
    ctx.close()

    # ---------- MOBILE ----------
    mctx = b.new_context(viewport={"width": 390, "height": 844}, ignore_https_errors=True, is_mobile=True, has_touch=True, device_scale_factor=3)
    mp = mctx.new_page()
    login(mp, "biz@qa138.dev", "<MASKED_SECRET_001>")
    wait_text(mp, "Tray Test Tacos")
    mp.evaluate("go('dashboard','Discover')")
    mp.wait_for_timeout(2200)
    m1 = mp.evaluate("""() => ({
      filtersBtn: [...document.querySelectorAll('button')].some(x => x.textContent.trim().startsWith('Filters')),
      railOpen: document.getElementById('disc-rail').classList.contains('open'),
      chipRow: !!document.querySelector('.shop-chiprow'),
      searchVisible: !!document.querySelector('.shop-searchrow input[type=search]'),
    })""")
    check("mobile find: one Filters button + search + chip row", m1["filtersBtn"] and m1["searchVisible"] and m1["chipRow"], m1)
    check("mobile find: sheet closed at rest", not m1["railOpen"])
    mp.screenshot(path=f"{OUT}/m-biz-find.png")
    mp.evaluate("shopRailToggle('disc-rail')")
    mp.wait_for_timeout(700)
    m2 = mp.evaluate("""() => ({
      open: document.getElementById('disc-rail').classList.contains('open'),
      showBtn: (document.getElementById('disc-show-btn') || {}).textContent || '',
      groups: [...document.querySelectorAll('#disc-rail .df-label')].map(e => e.textContent.trim()),
    })""")
    check("mobile find: bottom sheet opens with groups + Show N", m2["open"] and "Show" in m2["showBtn"] and "Category" in m2["groups"], m2)
    mp.screenshot(path=f"{OUT}/m-biz-find-sheet.png")
    mp.evaluate("shopRailToggle('disc-rail')")
    mp.wait_for_timeout(500)
    # compare tray: tick two compare boxes on cards
    mp.evaluate("""() => { const boxes = [...document.querySelectorAll('[data-compare], .cmp-toggle, input[type=checkbox]')].filter(x => x.offsetParent); }""")
    tray = mp.evaluate("""() => {
      const t = document.querySelector('.shelf-tray');
      return t ? { present: true } : { present: false };
    }""")
    # The tray appears once 2 creators are compared; drive it through the app's own state if exposed.
    mp.evaluate("""() => {
      const cards = [...document.querySelectorAll('.shelf-card')];
      const btns = [...document.querySelectorAll('button')].filter(x => /compare/i.test(x.textContent));
      btns.slice(0, 2).forEach(x => x.click());
    }""")
    mp.wait_for_timeout(900)
    tray2 = mp.evaluate("""() => {
      const t = document.querySelector('.shelf-tray');
      if (!t) return { present: false };
      let escapes = 0, cols = 0;
      t.querySelectorAll('.shelf-tray-col').forEach(col => {
        cols++;
        const cr = col.getBoundingClientRect();
        col.querySelectorAll('*:not(.top-match-tag)').forEach(n => {
          const r = n.getBoundingClientRect();
          if (r.width && (r.left < cr.left - 1 || r.right > cr.right + 1)) escapes++;
        });
      });
      const tr = t.getBoundingClientRect();
      return { present: true, cols, escapes, withinPanel: tr.right <= window.innerWidth + 1 };
    }""")
    if tray2["present"]:
        check("mobile compare tray: columns hold their content", tray2["escapes"] == 0, tray2)
        check("mobile compare tray: stays on screen", tray2["withinPanel"], tray2)
        mp.screenshot(path=f"{OUT}/m-business-find-tray.png")
    else:
        check("mobile compare tray: renders with 2 compared", False, "tray not present after compare clicks")
    check("mobile find: zero horizontal overflow", overflow_ok(mp))
    mp.evaluate("signOut()"); mp.wait_for_timeout(900)
    login(mp, "alpha@qa138.dev", "<MASKED_SECRET_001>")
    wait_text(mp, "Hi, Alpha")
    mp.evaluate("go('dashboard','Find Offers')")
    mp.wait_for_timeout(2200)
    mf = mp.evaluate("""() => ({
      n: document.querySelectorAll('.mirror-card').length,
      filtersBtn: [...document.querySelectorAll('button')].some(x => x.textContent.trim().startsWith('Filters')),
    })""")
    check("mobile find offers: cards + Filters button", mf["n"] == 3 and mf["filtersBtn"], mf)
    mp.screenshot(path=f"{OUT}/m-creator-findoffers.png")
    mp.evaluate("state.foRailOpen = true; renderFindOffers()")
    mp.wait_for_timeout(700)
    mfg = mp.evaluate("""() => [...document.querySelectorAll('#fo-rail .df-label')].map(e => e.textContent.trim())""")
    check("mobile find offers: sheet holds the full filter set", all(g in mfg for g in ["The offer", "Category", "Distance from you", "Good to know"]), mfg)
    mp.screenshot(path=f"{OUT}/m-creator-findoffers-sheet.png")
    check("mobile find offers: zero horizontal overflow", overflow_ok(mp))
    mctx.close()
    b.close()

fails = [r for r in results if not r["ok"]]
print(f"\nQA2: {len(results) - len(fails)}/{len(results)} passed")
json.dump(results, open(os.path.expanduser("~/workspace/signl-app/.qa138/qa2-results.json"), "w"), indent=1)
