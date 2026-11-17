#!/usr/bin/env python3
"""verify-build194-probe.py — the rendered half of verify-build194.

Build -193 pinned the menu radius by SOURCE STRING in theme-v3.css
and shipped a false "matched": theme-v2.css's body.v3-on .more-row
{ border-radius: 16px } (specificity 0,2,1) outranked the -193 rule
(0,2,0), so every v3 menu row COMPUTED 16px while the suite passed.
This probe exists so that class of miss cannot pass silently again:
it renders the real app (local dev server + seeded fixture users,
one per shell), opens each menu, and reads COMPUTED styles with
getComputedStyle — never source text.

It prints one line, "PROBE194 {json}", with per-shell metrics:
for each of the six menus (creator, business, national business,
partner, Biz Dev, admin) and each desktop rail — every row's
borderRadius / height / font, the identity avatar's rendered size,
the identity name/state type, group-header type, active pill and
row pitch. verify-build194.mjs asserts on this JSON.

Run directly for debugging: python3 scripts/verify-build194-probe.py
"""
import json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.expanduser("~/workspace/xmedium-qa/pylibs"))
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PORT = 8998
BASE = f"http://127.0.0.1:{PORT}"
PW = "-".join(["qa189", "user", "pw"])
ADMIN_PW = "-".join(["qa189", "admin", "pw"])
SALT = "qa194salt"
HASH = subprocess.run(
    ["node", "-e",
     "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
     PW, SALT], capture_output=True, text=True, check=True).stdout.strip()
ADMIN_HASH = subprocess.run(
    ["node", "-e",
     "const c=require('crypto');process.stdout.write(c.scryptSync(process.argv[1],process.argv[2],64).toString('hex'))",
     ADMIN_PW, SALT], capture_output=True, text=True, check=True).stdout.strip()


def user(uid, role, name, email, pw_hash, **extra):
    rec = {"id": uid, "role": role, "name": name, "email": email,
           "passwordSalt": SALT, "passwordHash": pw_hash, "status": "approved",
           "createdAt": "2026-11-10T00:00:00.000Z"}
    rec.update(extra)
    return rec


def creator(handle):
    return {"market": "Nashville", "city": "Nashville",
            "creator": {"handle": handle, "categories": ["Food & Drink"],
                        "localAudiencePct": 55, "audienceStack": {"instagram": 6000},
                        "followerCount": 6000, "totalAudience": 6000, "hasPhoto": False,
                        "bio": "", "bestWork": [], "publicPage": True, "profileComplete": True}}


data = {}
def put(rec):
    data[f"user:{rec['id']}"] = rec
    data[f"email:{rec['email']}"] = {"userId": rec["id"]}

put(user("q194-admin", "admin", "Jeff Rimmer", "jeff@joinsignl.com", ADMIN_HASH))
put(user("q194-creator", "creator", "Casey Creator", "creator194qa@fixtures.dev", HASH, **creator("caseycreator")))
put(user("q194-biz", "business", "Biz Owner", "biz194qa@fixtures.dev", HASH,
         market="Nashville", city="Nashville",
         business={"businessName": "Fixture Tacos", "category": "Restaurant", "planId": "self-service"}))
put(user("q194-nat", "business", "Nat Owner", "nat194qa@fixtures.dev", HASH,
         market="Nashville",
         business={"businessName": "Nat Fixture Brands LLC", "brandName": "Nat Fixture",
                   "category": "Retail", "planId": None, "scope": "national",
                   "accessState": "active", "verifiedAt": "2026-11-16T00:00:00.000Z"}))
put(user("q194-partner", "partner", "Pat Partner", "partner194qa@fixtures.dev", HASH,
         market="Nashville",
         partner={"name": "Fixture Media Co", "code": "FIXTURE194", "type": "media",
                  "contactName": "Pat Partner", "markets": ["Nashville"], "status": "active",
                  "agreementStatus": "signed", "agreementSignedAt": "2026-11-01T00:00:00.000Z", "demo": False}))
put(user("q194-tony", "creator", "Tony Seat", "tony194qa@fixtures.dev", HASH,
         tester=True, createdAt="2026-01-01T00:00:00.000Z",
         bizdevSeat={"active": True, "marketId": "hampton-roads", "marketName": "Hampton Roads", "repCode": "HR-TONY"},
         **creator("tonyseat")))
data["bdevrep:q194-tony"] = {"userId": "q194-tony", "repCode": "HR-TONY",
                             "marketId": "hampton-roads", "marketName": "Hampton Roads", "active": True}

tmp = tempfile.mkdtemp(prefix="signl-194probe-")
db = os.path.join(tmp, "db.json")
with open(db, "w") as fh:
    json.dump(data, fh)
env = dict(os.environ, SIGNL_LOCAL="1", SIGNL_LOCAL_DB=db, SIGNL_MAIL_STUB="1",
           APP_URL=BASE, ADMIN_EMAIL="jeff@joinsignl.com", ADMIN_PASSWORD=ADMIN_PW,
           SIGNL_TEST_ALLOW_BUSINESS="1")
for k in ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "RESEND_API_KEY", "SIG_AI_API_KEY",
          "OPENAI_API_KEY", "GEMINI_API_KEY", "MAGGIE_AI_ENABLED"]:
    env.pop(k, None)
server = subprocess.Popen(["node", "scripts/dev-server.mjs", str(PORT)], cwd=ROOT, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

MENU_JS = """([panelSel, rowSel, labelSel, avaSel, nameSel, stateSel]) => {
  const panel = document.querySelector(panelSel);
  if (!panel) return {missing: panelSel};
  const rows = [...panel.querySelectorAll(rowSel)];
  const info = rows.map(r => {
    const cs = getComputedStyle(r);
    const lab = r.querySelector(labelSel);
    const lcs = lab ? getComputedStyle(lab) : cs;
    const svg = r.querySelector('svg');
    return {
      radius: cs.borderRadius, h: Math.round(r.getBoundingClientRect().height * 10) / 10,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily,
      labelSize: lcs.fontSize, labelFamily: lcs.fontFamily,
      pad: cs.paddingTop + '/' + cs.paddingLeft, marginTop: cs.marginTop, gap: cs.columnGap,
      iconW: svg ? Math.round(svg.getBoundingClientRect().width * 10) / 10 : null,
      chev: (() => { const c = r.querySelector('.more-chev'); return c ? getComputedStyle(c).display : null; })(),
      chipBg: (() => { const i = r.querySelector('.more-ic'); return i ? getComputedStyle(i).backgroundColor : null; })(),
    };
  });
  const ava = panel.querySelector(avaSel);
  const avaR = ava ? ava.getBoundingClientRect() : null;
  const nm = panel.querySelector(nameSel);
  const st = panel.querySelector(stateSel);
  const h5 = panel.querySelector('h5');
  const hcs = h5 ? getComputedStyle(h5) : null;
  const on = panel.querySelector('.row-on187, .on');
  const idc = panel.querySelector('.menu-idcard187, .tab-railfoot, .tab-user');
  return {
    rows: info,
    pitch: rows.length > 1 ? Math.round((rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top) * 10) / 10 : null,
    avatar: ava ? {w: Math.round(avaR.width * 10) / 10, h: Math.round(avaR.height * 10) / 10,
                   cw: getComputedStyle(ava).width, ch: getComputedStyle(ava).height} : null,
    idName: nm ? {size: getComputedStyle(nm).fontSize, weight: getComputedStyle(nm).fontWeight} : null,
    idState: st ? {size: getComputedStyle(st).fontSize, color: getComputedStyle(st).color} : null,
    header: hcs ? {size: hcs.fontSize, weight: hcs.fontWeight, color: hcs.color, transform: hcs.textTransform} : null,
    activeBg: on ? getComputedStyle(on).backgroundImage : null,
    identityLast: idc ? (panel.lastElementChild === idc || panel.lastElementChild.contains(idc) || panel.contains(idc) && [...panel.children].indexOf(idc) === panel.children.length - 1) : false,
    imgsOk: [...panel.querySelectorAll('img')].filter(i => i.offsetParent !== null).every(i => i.complete && i.naturalWidth > 0),
  };
}"""

metrics = {}
try:
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(120):
        try:
            op.open(BASE + "/api/bootstrap", timeout=2); break
        except Exception:
            time.sleep(0.25)
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chromium")

        def login(email, pw, mobile=False):
            if mobile:
                ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                    has_touch=True, device_scale_factor=3)
            else:
                ctx = b.new_context(viewport={"width": 1280, "height": 900})
            pg = ctx.new_page()
            pg.goto(BASE + "/", wait_until="domcontentloaded")
            pg.wait_for_function("() => typeof go === 'function' && !!state.boot", timeout=30000)
            pg.evaluate("""async ([e, pw]) => { await fetch('/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: e, password: pw})}); }""", [email, pw])
            pg.reload(wait_until="domcontentloaded")
            pg.wait_for_function("() => !!state.user", timeout=30000)
            pg.wait_for_timeout(1800)
            return ctx, pg

        SHELLS = [
            ("admin", "jeff@joinsignl.com", ADMIN_PW, "openHamburger137()", "#rail", ".rail-item", ".rail-label"),
            ("creator", "creator194qa@fixtures.dev", PW, "openHamburger137()", "#tabbar", ".tab-item", ".lbl-full"),
            ("business", "biz194qa@fixtures.dev", PW, "openHamburger137()", "#tabbar", ".tab-item", ".lbl-full"),
            ("partner", "partner194qa@fixtures.dev", PW, "openHamburger137()", "#tabbar", ".tab-item", ".lbl-full"),
            ("bizdev", "tony194qa@fixtures.dev", PW, "bdOpenDrawer168()", "#tabbar", ".tab-item", ".lbl-full"),
            ("national", "nat194qa@fixtures.dev", PW, "openHamburger137()", "#tabbar", ".tab-item", ".lbl-full"),
        ]
        for role, email, pw, opener, railSel, railRowSel, railLabSel in SHELLS:
            ctx, pg = login(email, pw, mobile=True)
            pg.evaluate(f"() => {opener}")
            pg.wait_for_timeout(700)
            metrics[role + "_menu"] = pg.evaluate(MENU_JS, [".ham137-panel", ".more-row", ".more-label",
                                                            ".mi-ava189", ".menu-idcard187-name", ".menu-idcard187-state"])
            ctx.close()
            ctx, pg = login(email, pw)
            metrics[role + "_rail"] = pg.evaluate(MENU_JS, [railSel, railRowSel, railLabSel,
                                                            ".tu-ava", ".tu-name", ".tu-sub"])
            ctx.close()
        b.close()
finally:
    server.terminate()

print("PROBE194 " + json.dumps(metrics))
