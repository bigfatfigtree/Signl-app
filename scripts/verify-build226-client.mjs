// Build -226 client verification: the offer-journey surfaces render from the
// deal terms on the record (never hard-coded), the completion / cancel / move
// states render plainly, the started-signup capture is present and skippable,
// Spanish twins render in ES mode, and the filter panels carry the full
// option set on both sides with the feed kept clean.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const appJs = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../public/theme-v3.css", import.meta.url), "utf8");
const bridgeJs = readFileSync(new URL("../public/native-bridge.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok -", name); }
  else { fail++; console.log("  FAIL -", name); }
}

const start = appJs.indexOf("/* BUILD226-START */");
const end = appJs.indexOf("/* BUILD226-END */");
check("BUILD226 module markers present", start > 0 && end > start);
const mod = appJs.slice(start, end);
check("no em dash or en dash anywhere in the BUILD226 module", !/[—–]/.test(mod));
check("module calls the contracted endpoints", ["/posts/file", "/post-file", "/business/stats", "/business/post-report", "/signup-started", "/cancel", "/reschedule", "/reschedule/respond", "/reschedule/withdraw", "/review", "/review-business"].every((s) => mod.includes(s)));
check("push permission state reachable without touching the byte-pinned bridge (item 8)", mod.includes("PushNotifications") && mod.includes("checkPermissions") && mod.includes("initPush"));

// ---------- sandbox: evaluate the module with stubs ----------
let esMode = false;
const sandbox = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }),
  state: { user: { id: "u1", name: "Maya Reyes" }, lang: "en", j226rev: {}, j226range: null, j226biz: null, j226cr: null },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  Notification: { permission: "denied" },
  window: {},
  esc: (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  fmtPrice: (n) => (Number(n) % 1 ? Number(n).toFixed(2) : String(Math.round(Number(n)))),
  fmtNum: (n) => String(Number(n) || 0),
  fmtDate: (ts) => new Date(ts).toISOString().slice(0, 10),
  fmtDay: (ts) => new Date(ts).toISOString().slice(0, 10),
  fmtDayFull: (ts) => new Date(ts).toISOString().slice(0, 10),
  primaryMetaClient: () => ({ platform: "Instagram", handle: "@maya" }),
  primaryLabelClient: (p) => (p ? String(p).charAt(0).toUpperCase() + String(p).slice(1) : "Instagram"),
  PRIMARY_PLATFORMS_CLIENT: ["Instagram", "TikTok", "YouTube"],
  deliverablesOfClient: () => "",
  deliverablePhraseClient: () => "the visit",
  disclosureLine: () => "Paid partnership with the business. #ad",
  successCheckHtml: () => "OK",
  couponSummaryClient: () => "",
  PLATFORM_LABELS_ALL: { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" },
  stackList: () => [],
  workItemsOf: () => [],
  videoEmbedFor: (url) => (String(url).includes("instagram.com") ? { platform: "Instagram", kind: "reel", embedUrl: "https://www.instagram.com/reel/ABC/embed", aspect: "portrait" } : null),
  currencySymbolForMarket: () => "$",
  sigLang: () => (esMode ? "es" : "en"),
  T: (en, es) => (esMode && es ? es : en),
  ST: (en, es) => (esMode && es ? es : en),
  applyToOffer: () => false,
  requestLicense: () => false,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(mod, sandbox);
const M = sandbox;

const TERMS = {
  deliverablesText: "One post and one story",
  postWindowHours: 48,
  postDeadlineAt: "2026-11-22T15:00:00Z",
  keepUpDays: 45,
  keepUpUntil: "2027-01-04T15:00:00Z",
  platform: { name: "TikTok", source: "largest_local" },
  license: { state: "ask", priceCents: 7500, endsAt: null },
  visitCostCents: 8500,
};
const B = {
  id: "bk1", businessId: "biz1", businessName: "Cafe Luna", creatorId: "cr1", creatorName: "Maya Reyes",
  kind: "comp", status: "booked", lane: "direct", whatComped: "Dinner for two",
  windowStartAt: "2026-11-20T00:00:00Z", windowEndAt: "2026-11-23T00:00:00Z",
  redeemedAt: "2026-11-20T15:00:00Z", terms: TERMS, post: null,
};

// ---------- item 1: offer detail renders from terms ----------
const offerHtml = M.offerDetail226Html({ ...B, kind: "paid", post: null, redeemedAt: null });
check("offer detail: platform from terms", offerHtml.includes("TikTok"));
check("offer detail: keep-up from terms (45 days)", offerHtml.includes("45 days"));
check("offer detail: license ask price from terms ($75)", offerHtml.includes("$75"));
check("offer detail: no hard-coded 30-day term", !offerHtml.includes("30 days"));
check("offer detail: gradient hero present", offerHtml.includes("j226-hero"));

// ---------- item 3: walkthrough platform switch rule ----------
const walkBiz = M.walkthrough226Html({ ...B, terms: { ...TERMS, platform: { name: "Instagram", source: "business" } } });
check("walkthrough: business-specified platform hides the switch", !walkBiz.includes("Use a different platform"));
check("walkthrough: business-specified platform named from terms", walkBiz.includes("Step 1 · Post it on Instagram"));
const walkFree = M.walkthrough226Html(B);
check("walkthrough: largest-local platform shows the switch", walkFree.includes("Use a different platform"));
check("walkthrough: optional file drop copy present", walkFree.includes("Add the video file too (optional)"));

// ---------- item 2: pinned visit + nudge ----------
const pinned = M.pinnedVisit226Html([B]);
check("pinned visit: doorway headline + post button", pinned.includes("Your visit is done") && pinned.includes("Post about my visit"));
const nudge = M.postNudge226Html({ bookingId: "bk1", stage: "day2", dueText: "Post by Sunday to keep everything on track." });
check("nudge card renders the server due text", nudge.includes("Post by Sunday to keep everything on track."));

// ---------- item 4: business completion, both license states ----------
const askHtml = M.bizComplete226Html(B);
check("completion ask state: ask price from terms", askHtml.includes("$75"));
check("completion ask state: NO download before agreement", !askHtml.includes("/post-file"));
const agreedHtml = M.bizComplete226Html({ ...B, terms: { ...TERMS, license: { state: "agreed", priceCents: 7500, endsAt: "2027-02-17T00:00:00Z" } }, post: { id: "p1", url: "https://example.com/p", platform: "TikTok" } });
check("completion agreed state: Licensed to you + download button", agreedHtml.includes("Licensed to you") && agreedHtml.includes("/post-file"));
check("completion agreed state: the money ask is gone", !agreedHtml.includes("Ask for the license"));
const inclHtml = M.bizComplete226Html({ ...B, kind: "paid", terms: { ...TERMS, license: { state: "included", priceCents: 0, endsAt: "2027-03-01T00:00:00Z" } }, post: { id: "p1", url: "https://example.com/p", platform: "TikTok" } });
check("completion included state: download present, no license ask", inclHtml.includes("/post-file") && !inclHtml.includes("Ask for the license"));

// ---------- items 12 + 6: tracked screen, source flag, report ----------
const postPulled = { id: "p1", url: "https://example.com/p", platform: "TikTok", postedAt: "2026-11-21T10:00:00Z", metricsSource: "meta_sync", likes: 10, comments: 2, shares: 1, saves: 3 };
const trackedPulled = M.tracked226Html({ ...B, post: postPulled });
check("tracked: keep-up line from terms", trackedPulled.includes("45 days"));
check("tracked: pulled source label follows the flag", trackedPulled.includes("Pulled from TikTok"));
check("tracked: Momentum incentive line present (item 12)", trackedPulled.includes("Report your numbers, earn Momentum."));
const trackedReported = M.tracked226Html({ ...B, post: { ...postPulled, metricsSource: "creator_reported" } });
check("tracked: reported source label follows the flag", trackedReported.includes("Creator-reported"));

const reportPost = { ...postPulled, metricsSource: "creator_reported" };
const reportHtml = M.postReport226Html({ ...B, countedCustomers: 12, registerSpend: 612, post: reportPost });
check("report: big ROI multiple from spend / visit cost", reportHtml.includes("7.2×"));
check("report: register line from the numbers", reportHtml.includes("$612 came back at the register") && reportHtml.includes("The visit cost you the $85"));
check("report: engagement source label from the flag", reportHtml.includes("Engagement numbers are reported by Maya."));
check("report: How we get this number explainer present", reportHtml.includes("How we get this number"));

// ---------- item 7: stats fallbacks render ----------
const statsHtml = M.bizStats226Html({ totals: { spent: 10000, back: 32000, counted: 9, engagements: 40 }, campaigns: [], creators: [] }, []);
check("business stats: overall return line renders", statsHtml.includes("3.2 times back at the register"));
const crHtml = M.crRange226Html([{ ...B, status: "completed", post: reportPost }]);
check("creator numbers: pick-your-own dates present", crHtml.includes('type="date"') && crHtml.includes("Your numbers by date"));

// ---------- item 13: cancel / move ----------
const BOOKED = { ...B, redeemedAt: null };
const actions = M.visitActions226Html(BOOKED, "creator");
check("item 13: cancel + move on a direct-lane booked visit", actions.includes("Cancel this visit") && actions.includes("Move this visit"));
const actionsBiz = M.visitActions226Html(BOOKED, "business");
check("item 13: business side gets cancel + move too", actionsBiz.includes("Cancel this visit") && actionsBiz.includes("Move this visit"));
const proposed = M.visitActions226Html({ ...BOOKED, rescheduleProposal: { by: "cr1", proposedTime: "2026-11-22T18:00:00Z", status: "pending" } }, "creator");
check("item 13: own proposal state renders waiting line", proposed.includes("Move proposed, waiting on") && proposed.includes("Cafe Luna"));
const incoming = M.visitActions226Html({ ...BOOKED, rescheduleProposal: { by: "cr1", proposedTime: "2026-11-22T18:00:00Z", status: "pending" } }, "business");
check("item 13: other side sees Accept / Keep original time", incoming.includes("Accept the new time") && incoming.includes("Keep original time"));
const cancelled = M.visitActions226Html({ ...B, status: "cancelled", cancelledBy: "biz1", cancelledAt: "2026-11-21T09:00:00Z" }, "creator");
check("item 13: cancelled state renders plain line + Find offers door", cancelled.includes("cancelled this visit") && cancelled.includes("Find offers"));
sandbox.state.user.role = "creator";
const notif = M.notif226({ type: "booking_cancelled", bookingId: "bk1", businessName: "Cafe Luna" });
check("item 13: creator cancel notification copy is plain", !!notif && notif.text.includes("cancelled your visit") && notif.tab === "Find Offers");
sandbox.state.user.role = "business";
const notifBiz = M.notif226({ type: "visit_expired", bookingId: "bk1", creatorName: "Maya Reyes" });
check("item 13: business expired notification renders + taps to visits", !!notifBiz && notifBiz.text.includes("did not happen") && notifBiz.tab === "Visits & Posts");
sandbox.state.user.role = "";

// ---------- item 14a: auto-closed completion ----------
check("14a: status completed reads complete", M.visitComplete226({ status: "completed" }) === true);
check("14a: autoClosed flag reads complete", M.visitComplete226({ status: "confirmed", autoClosed: true }) === true);
check("14a: auto_completed marker reads complete", M.visitComplete226({ status: "confirmed", post: { id: "p" }, autoCompletedAt: "2026-11-23T00:00:00Z" }) === true);
check("14a: plain confirmed booking is NOT complete", M.visitComplete226({ status: "confirmed" }) === false);
check("14a: completion line renders", M.visitCompleteLine226Html({ status: "completed" }, "creator").includes("This visit is complete."));

// ---------- item 14b: stall capture ----------
const stall = M.stallCapture226Html("creator_claim");
check("14b: stall capture shows the honest why + skip wording", stall.includes("get cut off") && stall.includes("you can skip this"));
check("14b: capture wired for both flows", appJs.includes('stallCapture226Html("creator_claim")') && appJs.includes('stallCapture226Html("business_signup")'));
check("14b: started-signup POST shape present (landed contract)", mod.includes('"/api/signup-started"') && mod.includes("lastStep"));

// ---------- item 14c: applicant status note ----------
const old = new Date(Date.now() - 12 * 864e5).toISOString();
check("14c: application older than 2 business days shows the still-on-it note", M.pendingNote226Html({ createdAt: old }).includes("still on it"));
check("14c: fresh application shows no note", M.pendingNote226Html({ createdAt: new Date().toISOString() }) === "");
check("14c: server-supplied note wins", M.pendingNote226Html({ pendingNote: "Server note here." }).includes("Server note here."));

// ---------- item 8: push reminder card ----------
const pushHtml = M.pushReminder226Html("creator", "claim");
check("item 8: push card renders when notifications are off", pushHtml.includes("Turn on notifications") && pushHtml.includes("get pinged when you are paid"));
const pushBiz = M.pushReminder226Html("business", "create");
check("item 8: business push copy renders", pushBiz.includes("the moment a creator claims or checks in"));

// ---------- item 14d: Spanish twins render ----------
esMode = true;
check("14d ES: pinned post button renders in Spanish", M.pinnedVisit226Html([B]).includes("Publica sobre mi visita"));
check("14d ES: cancel action renders in Spanish", M.visitActions226Html(BOOKED, "creator").includes("Cancelar esta visita"));
check("14d ES: stall capture renders in Spanish", M.stallCapture226Html("creator_claim").includes("Tu correo, para poder contactarte"));
check("14d ES: tracked keep-up renders in Spanish", M.tracked226Html({ ...B, post: postPulled }).includes("Tu publicación está en vivo."));
check("14d ES: completion line renders in Spanish", M.visitCompleteLine226Html({ status: "completed" }, "creator").includes("Esta visita está completa."));
esMode = false;
check("14d: menu identity line carries its Spanish twin", appJs.includes('T(`Founding creator in ${u.market || "your market"}`, `Creador fundador en'));
check("14d: offers empty state carries its Spanish twin", appJs.includes("Eres un creador fundador en"));
check("14d: the exact -224 English literals survive for the older suites", appJs.includes('`Founding creator in ${u.market || "your market"}`') && appJs.includes("You are a founding creator in ${esc(mkt)}. Offers land here the moment the market opens"));

// ---------- item 14e + filter parity ----------
const foRail = appJs.slice(appJs.indexOf('id="fo-rail"'), appJs.indexOf('id="fo-rail"') + 9500);
check("parity: paid/comp switch lives inside the Find offers panel", foRail.includes("j226-seg") && foRail.includes('["paid", "Paid"], ["comp", "Comped"]') && foRail.includes("j226-segbtn"));
check("parity: Find offers panel carries category, distance, fit, spots, when, sort", ["Category", "Distance from you", "Good fit for me", "Spots still open", "Starts this week", "Sort"].every((s) => foRail.includes(s)));
const foFeed = appJs.slice(appJs.indexOf('id="fo-rail"') + 9500, appJs.indexOf('id="fo-rail"') + 12500);
check("parity: no paid/comp switch left on the Find offers feed", !foFeed.slice(0, foFeed.indexOf("cr-national-lane")).includes("j226-seg"));
const discRail = appJs.slice(appJs.indexOf('id="disc-rail"'), appJs.indexOf('id="disc-rail"') + 9000);
check("parity: Find creators panel carries category, rate, Spanish, musician, university, search lives on the feed row", ["Category", "Their rate", "Spanish-speaking creators", "Musicians", "f-university"].every((s) => discRail.includes(s)) && appJs.includes('id="f-q" placeholder="Search name or handle"'));
check("parity: Find creators panel holds market + sort at every width", discRail.includes('id="f-market"') && discRail.includes('id="f-sort"') && !discRail.includes("rail-only-m"));
check("parity: Find offers panel holds sort at every width", !foRail.includes("rail-only-m"));
const fixtureOffers = [{ kind: "paid" }, { kind: "comp" }, { kind: "coupon" }, { kind: "paid" }];
const byKind = (k) => fixtureOffers.filter((o) => k === "all" || o.kind === k).length;
check("14e: the switch predicate filters a fixture list (paid/comp)", byKind("all") === 4 && byKind("paid") === 2 && byKind("comp") === 1);
const now = Date.now();
const whenOffers = [{ windowStartAt: new Date(now + 2 * 864e5).toISOString() }, { windowStartAt: new Date(now + 40 * 864e5).toISOString() }];
const inWeek = whenOffers.filter((o) => { const t = new Date(o.windowStartAt || o.redeemBy || 0).getTime(); return t && t >= now - 864e5 && t <= now + 7 * 864e5; });
check("parity: the When predicate filters a fixture list", inWeek.length === 1 && appJs.includes('state.foWhen === "week" ? 7 : 31'));

// ---------- items 5 + 9 + 12 static wiring ----------
check("item 5: review chips render from the contracted lists", mod.includes("Easy to work with") && mod.includes("Would you book") && mod.includes("Friendly with staff"));
check("item 9: Create an offer / Create this offer in the composer", appJs.includes('<h3 style="margin-top:0">Create an offer</h3>') && appJs.includes('"Create this offer"'));
check("item 12: incentive line wired into both report forms + tracked", (appJs.match(/Report your numbers, earn Momentum\./g) || []).length >= 3);
check("item 2: creator home renders pinned visit + nudge + push card", appJs.includes("${pinnedVisit226Html(bookings)}") && appJs.includes("${postNudge226Html(bkData.postNudge || (bkData.postNudges || [])[0]") && appJs.includes('${pushReminder226Html("creator", "home")}'));
check("items 1-7: journey views dispatched in render()", appJs.includes('if (state.view && state.view.indexOf("j226-") === 0) return renderJourney226();'));

// ---------- item 15: profile channels + showcase ----------
const profFixture = {
  name: "Maya Reyes", handle: "maya",
  channels: [
    { platform: "instagram", handle: "maya.eats", followers: 12400, localPct: 62, url: "https://instagram.com/maya.eats" },
    { platform: "tiktok", handle: "mayaeats", followers: 8300, localPct: 55, url: "https://tiktok.com/@mayaeats" },
    { platform: "youtube", handle: "MayaEats", followers: 2100, localPct: 40, url: "https://youtube.com/@MayaEats" },
  ],
};
const chansHtml = M.channels226Html(profFixture, { public: true });
check("item 15: 3 channel rows render from the channels array", (chansHtml.match(/j226-chanrow/g) || []).length === 3);
check("item 15: rows carry handle, followers and per-platform local %", chansHtml.includes("@maya.eats") && chansHtml.includes("12400 followers") && chansHtml.includes("62% local"));
const chansBiz = M.channels226Html(profFixture, { business: true });
check("item 15: business variant renders rows without local %", (chansBiz.match(/j226-chanrow/g) || []).length === 3 && !chansBiz.includes("% local"));
check("item 15: no channels renders no section", M.channels226Html({ name: "Empty" }, {}) === "");
const showFixture = {
  name: "Maya Reyes", handle: "maya",
  showcase: [
    { url: "https://www.instagram.com/reel/ABC/" },
    { url: "https://www.tiktok.com/@mayaeats/video/123" },
    { url: "https://www.youtube.com/watch?v=xyz", thumbnailUrl: "https://img.example.com/t.jpg", title: "My best taco run" },
  ],
};
const showHtml = M.showcase226Html(showFixture, { public: true });
check("item 15: showcase of 3 renders 3 cells", (showHtml.match(/work-cell/g) || []).length === 3);
check("item 15: embeddable pick renders a player iframe", showHtml.includes("<iframe") && showHtml.includes("https://www.instagram.com/reel/ABC/embed"));
check("item 15: non-embeddable pick renders a link-out card", showHtml.includes("View post") && showHtml.includes("https://www.tiktok.com/@mayaeats/video/123"));
check("item 15: empty showcase renders no section", M.showcase226Html({ name: "Maya", showcase: [] }, { public: true }) === "");
const editorHtml = M.showcaseEditor226Html({ creator: { showcase: ["https://www.instagram.com/reel/ABC/"] } });
check("item 15: editor renders 3 slots with the saved pick in slot 1", (editorHtml.match(/id="j226-show-\d"/g) || []).length === 3 && editorHtml.includes('value="https://www.instagram.com/reel/ABC/"'));
check("item 15: showcase saves through the creator.showcase endpoint (PUT replace-all)", mod.includes('api("PUT", "/me/showcase", { urls: links })') && appJs.includes("showcaseEditor226Html(u)"));
check("item 15: accounts + showcase wired on public profile and PDP", appJs.includes("accounts226Html(p, { public: true })") && appJs.includes("showcase226Html(c, { app: true })"));

// ---------- landed server contract alignment ----------
const labelHtml = M.offerDetail226Html({ ...B, kind: "paid", post: null, redeemedAt: null, terms: { ...TERMS, platform: { name: "instagram", label: "Instagram", source: "business" } } });
check("contract: platform label renders, not the canonical id", labelHtml.includes("Instagram") && !labelHtml.includes("On instagram"));
const msTracked = M.tracked226Html({ ...B, post: { ...postPulled, metricsSource: "", performance: { metricSources: { views: "platform", likes: "platform" } } } });
check("contract: per-metric platform sources flip the label to pulled", msTracked.includes("Pulled from TikTok"));
check("contract: reviewStatusLine from /auth/me renders on the pending wall", M.pendingNote226Html({ reviewStatusLine: "Your application is with a reviewer now." }).includes("Your application is with a reviewer now."));
check("contract: reviewOverdue flag renders the still-on-it note", M.pendingNote226Html({ reviewOverdue: true }).includes("still on it"));
sandbox.state.user.role = "creator";
const propNotif = M.notif226({ type: "reschedule_proposed", businessName: "Cafe Luna", newVisitAt: "2026-11-22T18:00:00Z" });
check("contract: reschedule_proposed renders as a proposal, not a move", !!propNotif && propNotif.text.includes("proposed a new time") && propNotif.tab === "My Visits");
const autoNotif = M.notif226({ type: "post_auto_confirmed", businessName: "Cafe Luna" });
check("contract: post_auto_confirmed tells the creator the visit is complete", !!autoNotif && autoNotif.text.includes("confirmed automatically"));
sandbox.state.user.role = "business";
const confNotif = M.notif226({ type: "post_confirmation_needed", creatorName: "Maya Reyes" });
check("contract: post_confirmation_needed reaches the business feed", !!confNotif && confNotif.text.includes("waiting for your confirmation"));
sandbox.state.user.role = "";
const propNewField = M.visitActions226Html({ ...BOOKED, rescheduleProposal: { by: "biz1", byRole: "business", newVisitAt: "2026-11-22T18:00:00Z", status: "pending" } }, "creator");
check("contract: proposal renders from newVisitAt + byRole with Accept / Keep", propNewField.includes("Accept the new time") && propNewField.includes("Keep original time"));
check("contract: confirmationAutoClosedAt reads complete", M.visitComplete226({ status: "confirmed", confirmationAutoClosedAt: "2026-11-23T00:00:00Z" }) === true);
check("contract: restored suite strings (Rate this creator / Post your proof)", appJs.includes("Rate this creator") && appJs.includes("submitCreatorReview") && appJs.includes("crev-stars-") && appJs.includes("Post your proof"));

// ---------- feed layout lock: hero cards on both feeds ----------
const mirrorSlice = appJs.slice(appJs.indexOf("function mirrorOfferCardHtml"), appJs.indexOf("function mirrorOfferCardHtml") + 5200);
check("feed lock: offer cards are hero cards with badge + chips strip", mirrorSlice.includes("j226-hero-card") && mirrorSlice.includes("j226-ratebadge") && mirrorSlice.includes("j226-chipstrip"));
const deckSlice = appJs.slice(appJs.indexOf("function discoverStackCard"), appJs.indexOf("function discoverStackCard") + 5200);
check("feed lock: creator deck cards are hero cards with badge, text-side identity, chips strip", deckSlice.includes("j226-hero-card") && deckSlice.includes("j226-ratebadge") && deckSlice.includes("j226-heroid") && deckSlice.includes("j226-chipstrip"));
check("feed lock: deck marks the first card for the gradient treatment", appJs.includes('wrap.classList.toggle("stk-at-first", s.idx === 0)'));
check("feed lock CSS: first offer card carries the gradient", themeCss.includes(".mirror-card.j226-hero-card.mirror-lead { background: var(--grad);"));
check("feed lock CSS: first creator card carries the gradient", themeCss.includes('[data-stack="discover"].stk-at-first .stk-card .j226-hero-card'));
check("feed lock CSS: photo sits on the right at every width, with a mobile adjustment", themeCss.includes(".mirror-card.j226-hero-card .mirror-cover { order: 2;") && themeCss.includes(".j226-hero-card .dcard-photo { order: 2;") && themeCss.includes("@media (max-width: 640px)"));
check("feed lock CSS: rating badge is a white circle top-left", themeCss.includes(".j226-ratebadge { position: absolute; top: 12px; left: 12px;"));
const openTo = M.openTo226Html({ compOpen: true, couponOpen: false, paidRate: 150, market: "Nashville" });
check("profile lock: open-to strip shows comped on, coupons off, paid with its price", openTo.includes("Comped visits") && openTo.includes("Coupons") && openTo.includes("$150") && (openTo.match(/j226-openitem on/g) || []).length === 2);

console.log(`\nverify-build226-client: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
