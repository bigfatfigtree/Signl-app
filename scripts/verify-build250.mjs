#!/usr/bin/env node
// verify-build250.mjs — Build -250 (bundle with -249): journey
// screen cleanup + the walkthrough defect fixes.
//   A. Source pins for the presentation rebuilds: deal card
//      value hero + terms group + per-kind decline reasons +
//      the explainer behind a tap; visit card code hero in the
//      gradient, one audience section, stepper timeline, rows
//      deal panel, slim honor line; completion review as its
//      own step; offer detail ES parity; the comped "free
//      visit" line retired; foClearAll clears the search;
//      state-aware blue-check sheet; the -247 follow-on text
//      pass (Golden Tickets, Receipt, lane pricing notes).
//   B. Behavioral over HTTP: a comped deal carries NO under/
//      over gap line while a paid deal under the listed rate
//      still does; the businesses-near list prints the canon
//      per-platform local-follower count (17,221), not the
//      headline-% product (17,630).
// Run: node scripts/verify-build250.mjs
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const app = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/theme-v3.css"), "utf8");
const router = fs.readFileSync(path.join(ROOT, "netlify/functions/lib/router.js"), "utf8");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? " :: " + String(extra).slice(0, 220) : ""}`); }
}
function part(t) { console.log(`\n== ${t}`); }

part("A1. Screen A: deal accept");
check("value hero exists and leads with the amount in the gradient value style",
  app.includes("function dealHero250") && app.includes('class="j226-val"') && app.includes("${dealHero250(t, role)}"));
check("comp hero states the comp value plainly", app.includes("Comp value") && app.includes("deal-hero-sub"));
check("the old 'You get' row is gone from the deal card",
  !app.slice(app.indexOf("function dealProposalCardHtml"), app.indexOf("function dealCounterFormHtml")).includes("You get"));
check("terms sit under a group label", app.includes('<p class="deal-group250">The terms</p>'));
check("explainer paragraph is behind a tap, wording preserved",
  app.includes('<summary class="small muted">What is a deal?</summary>') && app.includes("A deal is a one-to-one offer between one business and one creator"));
check("decline reasons are built per kind; rate leads only on paid/mix",
  app.includes('const reasonOpts') && app.includes('t.kind === "paid" || t.kind === "mix" ? `<option value="rate">The rate does not work</option>` : ""'));
check("server: gap line gated to paid/mix kinds",
  router.includes('const gapKind = (cur && cur.terms && cur.terms.kind) || deal.kind || "";') && router.includes('(gapKind === "paid" || gapKind === "mix") && listed !== null'));
check("deal-sent landing: sendDeal points Your campaigns at the Deals segment",
  app.includes('state.offersSeg = "deals";'));

part("A2. Screen B: visit details");
check("visit code hero: gradient class on the code, high on the card",
  app.includes('class="code-display code-grad250"') && app.includes("j250-codehero")
  && app.indexOf("j250-codehero") > app.indexOf("html += dealCardHtml(b, role);")
  && app.indexOf("j250-codehero") < app.indexOf("html += visitTimelineHtml(b);"));
check("gradient treatment defined (value-line gradient, clipped to the glyphs)",
  css.includes(".code-grad250") && css.includes("-webkit-background-clip: text") && css.includes("background: var(--grad)"));
check("Codes segment code wears the gradient too", app.includes('class="bigcode119 code-grad250"'));
check("one audience section, set apart, with its own label",
  app.includes('class="j250-audsec"') && app.includes('>For your audience</p>') && css.includes(".j250-audsec"));
check("the duplicated audience header is gone",
  !app.includes('<h4>For the audience: ${esc(b.audienceOffer.title'));
check("the two stacked audience-code blocks are merged (one 'Audience code:' heading)",
  (app.match(/<h4>Audience code: /g) || []).length === 1 && !app.includes("Your audience code at"));
check("timeline is a stepper (dots + states), not text rows",
  app.includes('class="vt250-step ') && app.includes("vt250-dot") && css.includes(".vt250-step.done .vt250-dot"));
check("deal panel prose became labelled rows",
  app.includes('<div class="lrow"><span>Posts</span>') && app.includes('<div class="lrow"><span>Rights</span>') && app.includes('<div class="lrow"><span>Counted</span>') && !app.includes("What gets posted:"));
check("brief standards paragraph sits behind a tap",
  app.includes('<summary class="small muted">About these standards</summary>'));
check("honor explanation is one line", app.includes("Filing this voids the visit and stops the clock. It cannot hurt your standing, and it is never shown publicly.")
  && !app.includes("The business didn't honor this comp. Filing this voids the visit"));

part("A3. Screen C: completion sequencing");
check("completion renders a rate entry row, not the review form",
  app.includes("function reviewEntry250Html") && app.includes('data-j226="review-entry"')
  && app.includes('${reviewEntry250Html(b, "creator")}') && app.includes('${reviewEntry250Html(b, "business")}')
  && !app.includes('data-j226="review-slot"'));
check("the review is its own journey view, dispatched and back-linked",
  app.includes('function reviewStep226Html') && app.includes('view === "j226-review"') && app.includes("function openReview226"));
check("the review form itself is untouched (same prompt, chips, endpoints)",
  app.includes("function reviewPrompt226Html") && app.includes("REVIEW_CHIPS_226") && app.includes('"/review-business"') && app.includes('"/review"'));

part("A4. Walkthrough + queued fixes");
check("the comped visit is never called free in the walkthrough (EN or ES)",
  !app.includes("so the free visit is disclosed") && !app.includes("la visita gratis")
  && app.includes("so the comped visit is disclosed") && app.includes("la visita por cortesía quede declarada"));
check("Find offers Clear all clears the search text",
  app.slice(app.indexOf("function foClearAll()"), app.indexOf("function foKnowAll()")).includes('state.foQ = "";'));
check("canon local-follower helper: home market reads the per-platform model",
  router.includes("function canonLocalFollowers250") && router.includes("neighborCountFor((creatorUser && creatorUser.creator) || {})")
  && router.includes("localFollowers: canonLocalFollowers250(cand.c, biz.market).local")
  && router.includes("const lf = canonLocalFollowers250(user, x.market);"));
check("blue-check sheet is state-aware (not-yet wording + gap, earned wording kept)",
  app.includes('function blueCheckSheet226Html(mode, points)') && app.includes('J226("Standout, not yet", "Standout, todavía no")')
  && app.includes("This creator reached Standout") && app.includes("openBlueCheck226('${earned ? \"earned\" : \"notyet\"}', ${pts})"));
check("Golden Tickets prose sits behind a tap, wording preserved",
  app.includes('<summary class="small muted">How Golden Tickets work</summary>') && app.includes("Two seats, and only you can give them") && app.includes("Nothing is paid for a click or a share."));
check("Receipt founding methodology sits behind the info button",
  router.length > 0 && app.includes('receipt: { title: "How the receipt counts"') && app.includes('${roasInfoBtn("receipt")}'));
check("Receipt 'What it cost' paragraph trimmed to the pointer line, info button carries the rest",
  app.includes('Every cost inside your score is itemized ${hasScore ? "under the Costs tab" : "in the score block above"}.') && app.includes('<h4 style="margin:0 0 4px">What it cost ${roasInfoBtn("costs")}</h4>'));
check("lane pricing notes: one line at the field, full terms behind a tap, license still named at the field",
  app.includes("A paid booking includes the standard license: 90 days of repost and ad use.")
  && app.includes('<summary class="small muted">How the rate and license work</summary>')
  && app.includes("One price for 90 days of repost and ad use. You approve every request; nothing runs without your yes.")
  && app.includes('<summary class="small muted">How this fee works</summary>'));

part("A5. Offer detail ES parity");
check("row labels carry Spanish twins",
  app.includes('${J226("Where", "Dónde")}') && app.includes('${J226("When", "Cuándo")}') && app.includes('${J226("What to post", "Qué publicar")}') && app.includes('${J226("Using the post", "Uso de la publicación")}'));
check("composed sentences carry Spanish twins (offer, platform, license, applied)",
  app.includes("con un valor de ") && app.includes("donde tu audiencia local es mayor") && app.includes("La licencia estándar está incluida con esta reserva") && app.includes("Tu postulación ya está"));
check("deliverables + window words have Spanish twins",
  app.includes("function deliverablesEs250") && app.includes("function windowWordsEs250") && app.includes("Mantén la publicación activa por lo menos"));
check("offer view chrome is localized (back link + missing-offer line)",
  app.includes('${J226("All visits", "Todas las visitas")}') && app.includes("Esa oferta ya no está en el registro."));

part("B. Behavioral: gap line + canon followers over HTTP");
const PORT = 9250;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = "qa-pass-250";
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync(PW, salt, 64).toString("hex");
const NOW = "2026-11-15T00:00:00.000Z";
const data = {};
function putUser(u) { data[`user:${u.id}`] = u; data[`email:${u.email}`] = { userId: u.id }; }
putUser({ id: "q250-biz", role: "business", email: "biz@b250qa.dev", name: "Biz Owner", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: NOW, updatedAt: NOW,
  business: { businessName: "Juniper Table", category: "Restaurant", plan: "growth", planId: "growth", accessState: "active", neighborhood: "12 South", hasPhoto: true, photoCount: 1 } });
putUser({ id: "q250-cr", role: "creator", email: "priya@b250qa.dev", name: "Priya Nair", passwordSalt: salt, passwordHash: hash, status: "approved", market: "Nashville", city: "Nashville", createdAt: NOW, updatedAt: NOW,
  creator: { handle: "priyaeats", followerCount: 10400, totalAudience: 21500, audienceStack: { instagram: 10400, tiktok: 7300, threads: 3800 }, platformLocalPct: { instagram: 82, tiktok: 79, threads: 77 }, localAudiencePct: 82, categories: ["Food & Drink"], hasPhoto: true, photoCount: 1, bio: "Nashville food, weekly.", paidRate: 125, licensingFee: 150, compOpen: true, couponOpen: true, neighborhood: "12 South", profileComplete: true, tierBand: "Locals" } });
data["config:markets"] = { flags: { Nashville: true } };
const DB = path.join(os.tmpdir(), `signl-verify-b250-${Date.now()}.json`);
fs.writeFileSync(DB, JSON.stringify(data));
const env = { ...process.env, SIGNL_LOCAL: "1", SIGNL_LOCAL_DB: DB, SIGNL_MAIL_STUB: "1", APP_URL: BASE, ADMIN_EMAIL: "admin@b250.dev", ADMIN_PASSWORD: "qa-admin-pass-250" };
for (const k of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "NOTIFY_EMAIL_PROVIDER", "FIREBASE_SERVICE_ACCOUNT_JSON"]) delete env[k];
const server = spawn("node", ["scripts/dev-server.mjs", String(PORT)], { cwd: ROOT, env, stdio: "ignore" });
async function req(method, p, body, cookie) {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const setCookie = (r.headers.get("set-cookie") || "").split(";")[0];
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  return { status: r.status, j, setCookie };
}
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { const r = await fetch(BASE + "/api/bootstrap"); up = r.status > 0; } catch (e) { await new Promise((r) => setTimeout(r, 250)); } }
  check("dev server boots", up);
  const bizLogin = await req("POST", "/api/auth/login", { email: "biz@b250qa.dev", password: PW });
  const crLogin = await req("POST", "/api/auth/login", { email: "priya@b250qa.dev", password: PW });
  check("both roles sign in", bizLogin.status === 200 && crLogin.status === 200, `${bizLogin.status}/${crLogin.status}`);
  const bizCk = bizLogin.setCookie, crCk = crLogin.setCookie;
  const compDeal = await req("POST", "/api/deals", { creatorId: "q250-cr", kind: "comp", title: "Dinner for two", dollarCap: 85, whatComped: "Dinner for two: two mains, two drinks", timingWindow: "week", deliverables: { posts: 1, story: true }, postingTerms: { type: "standard" }, expiresInHours: 48 }, bizCk);
  check("comp deal created", compDeal.status === 201 || compDeal.status === 200 && !!(compDeal.j && compDeal.j.deal), JSON.stringify(compDeal.j).slice(0, 200));
  const paidDeal = await req("POST", "/api/deals", { creatorId: "q250-cr", kind: "paid", title: "Brunch post", cashRate: 100, timingWindow: "week", deliverables: { posts: 1, story: true }, postingTerms: { type: "standard" }, expiresInHours: 48 }, bizCk);
  check("paid deal created", paidDeal.status === 201 || paidDeal.status === 200 && !!(paidDeal.j && paidDeal.j.deal), JSON.stringify(paidDeal.j).slice(0, 200));
  const list = await req("GET", "/api/deals", null, crCk);
  const deals = (list.j && list.j.deals) || [];
  const comp = deals.find((d) => d.id === (compDeal.j && compDeal.j.deal && compDeal.j.deal.id));
  const paid = deals.find((d) => d.id === (paidDeal.j && paidDeal.j.deal && paidDeal.j.deal.id));
  check("comp deal carries NO gap line (its $85 cap is not framed against the $125 rate)", !!comp && comp.gap === null, JSON.stringify(comp && comp.gap));
  check("paid deal under the listed rate keeps the accurate gap line", !!paid && !!paid.gap && /under it/.test(paid.gap.line || ""), JSON.stringify(paid && paid.gap));
  const forMe = await req("GET", "/api/block/for-me", null, crCk);
  const rows = (forMe.j && (forMe.j.businesses || forMe.j.rows || forMe.j.out)) || [];
  const juniper = rows.find((x) => x.businessId === "q250-biz");
  check("businesses-near prints the canon per-platform count (17,221), not headline-% x total (17,630)",
    !!juniper && juniper.yourLocalFollowers === 17221, JSON.stringify(juniper).slice(0, 200));
} finally {
  server.kill();
  try { fs.unlinkSync(DB); } catch (e) { /* already gone */ }
}
console.log(`\nverify-build250: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
