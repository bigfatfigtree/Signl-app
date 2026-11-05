// Transactional notification rail (Build -87, Tier 1 item 1).
//
// One call the product uses for every clock event:
//   notify(userRecord, eventType, payload)
// It routes to SMS + transactional email per the recipient's
// per-type preferences (user.notifyPrefs, flat keys below,
// default ON for every clock-critical type).
//
// PROVIDER CONFIG IS ENV-ONLY, NEVER HARDCODED:
//   SMS (Twilio):  TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
//                  TWILIO_FROM_NUMBER
//   Email:         NOTIFY_EMAIL_PROVIDER = "resend" | "postmark"
//                  RESEND_API_KEY  or  POSTMARK_SERVER_TOKEN
//                  NOTIFY_EMAIL_FROM (optional; default
//                  "SIGNL <hello@joinsignl.com>")
// When a channel's env is absent, that channel runs in SANDBOX
// mode: the send is recorded to the notifications outbox
// (store key notifyoutbox:{id}) with status "sandbox" instead of
// being transmitted, so the whole system verifies end-to-end
// with zero live sends. When env IS present, the send is
// attempted over the provider's HTTPS API (no SDK dependency)
// and the outbox records the outcome ("sent" / "failed").
//
// Tester fencing (canon): a tester-flagged account NEVER receives
// a real notification. Its would-be sends are recorded with
// status "fenced_tester" and transmitted: false, and testers
// never appear in any count this rail reports.
//
// Outbox record shape:
//   { id, userId, role, eventType, prefKey, channel ("sms"|"email"),
//     to, subject (email only), text, status, sandbox, transmitted,
//     createdAt, providerRef? , reason? }
const crypto = require("crypto");
const store = require("./store");
const { logEvent } = require("./events");

// ---------- event catalog: clock events ONLY ----------
// prefKey is the notifyPrefs switch that governs the event.
const EVENT_TYPES = {
  // creator: a new offer landed / an early-access window opened
  creator_offer_new: { prefKey: "offers", role: "creator" },
  creator_early_access: { prefKey: "offers", role: "creator" },
  // creator: picked / booked
  creator_booked: { prefKey: "bookings", role: "creator" },
  // creator: the 48h post clock started / ~12h left on it
  post_clock_started: { prefKey: "postClock", role: "creator" },
  post_clock_12h: { prefKey: "postClock", role: "creator" },
  // creator: a licence request is waiting on them
  licence_waiting_creator: { prefKey: "licences", role: "creator" },
  // business: applications are waiting in the stack
  business_applications_waiting: { prefKey: "applications", role: "business" },
  // business: a licence state they were waiting on has moved
  business_licence_waiting: { prefKey: "licences", role: "business" },
  // business: new finished creators in their market/category
  // (Tier 1 item 6's hook: the event type + API live here; the
  // wishlist/roster lane calls notify() with it.)
  roster_drop: { prefKey: "roster", role: "business" },
  // business: a licence they hold is nearing its end date
  // (Build -95: fired by the licence-expiry sweep in the
  // router at 14 days and 1 day out, each threshold at most
  // once per licence). Its own switch: a business can silence
  // expiry nudges without silencing licence-request updates.
  licence_expiring: { prefKey: "licenceExpiry", role: "business" },
  // Build -132: the Offer Card (structured negotiation). A deal
  // landing, a counter landing, a deal resolving (accepted or
  // declined), and a deal expiring are clock events for both
  // sides: they carry deadlines, so they ride the offers switch.
  creator_deal_new: { prefKey: "offers", role: "creator" },
  creator_deal_countered: { prefKey: "offers", role: "creator" },
  creator_deal_resolved: { prefKey: "offers", role: "creator" },
  creator_deal_expired: { prefKey: "offers", role: "creator" },
  business_deal_countered: { prefKey: "offers", role: "business" },
  business_deal_resolved: { prefKey: "offers", role: "business" },
  business_deal_expired: { prefKey: "offers", role: "business" },
  // Build -132: creator match alerts (open offers that match a
  // creator's saved alert preferences). The matching pass only
  // ever calls this when something actually matches: silence
  // when nothing matches is the rule (Indeed pattern).
  creator_match_alert: { prefKey: "offers", role: "creator" },
  // Build -132: a coupon deal's coupon reached its expiry with
  // value unspent (creator side) — the honest close-out.
  creator_coupon_expired: { prefKey: "bookings", role: "creator" },
};
const PREF_KEYS = ["offers", "bookings", "postClock", "licences", "applications", "roster", "licenceExpiry"];

function defaultPrefs() {
  const out = {};
  for (const k of PREF_KEYS) out[k] = true;
  return out;
}

// The recipient's clock prefs, defaults ON, merged over whatever
// is stored. The older Build -47 email switches (emailActivity /
// emailMessages / emailReminders) live on the same record and are
// untouched by this rail.
function clockPrefsOf(user) {
  const prefs = (user && user.notifyPrefs) || {};
  const out = defaultPrefs();
  for (const k of PREF_KEYS) if (typeof prefs[k] === "boolean") out[k] = prefs[k];
  return out;
}

function prefEnabled(user, eventType) {
  const def = EVENT_TYPES[eventType];
  if (!def) return false;
  return clockPrefsOf(user)[def.prefKey] !== false;
}

function isTester(user) {
  return !!(user && user.tester);
}

function phoneOf(user) {
  if (!user) return "";
  const p = user.phone || (user.creator && user.creator.phone) || (user.business && user.business.phone) || "";
  return String(p || "").trim();
}

// ---------- rendering ----------
// Plain words, no insider terms unexplained, short enough for an
// SMS. payload may carry: businessName, offerTitle, title,
// deadlineText, feeText, count, market, category.
function render(eventType, payload = {}) {
  const biz = payload.businessName || "A local business";
  const title = payload.offerTitle || payload.title || "an offer";
  const deadline = payload.deadlineText ? ` Post by ${payload.deadlineText}.` : "";
  switch (eventType) {
    case "creator_offer_new":
      return { subject: `New SIGNL offer: ${title}`, sms: `SIGNL: New offer from ${biz}: "${title}". Open SIGNL to see it and apply.`, email: `You have a new offer on SIGNL.\n\n${biz} posted: "${title}".\n\nOpen SIGNL to see what is included and apply: https://app.joinsignl.com` };
    case "creator_early_access":
      return { subject: `Early access is open: ${title}`, sms: `SIGNL: Your early-access window is open for "${title}" at ${biz}. Apply before it opens to everyone.`, email: `Your early-access window just opened on SIGNL.\n\n"${title}" at ${biz} is open to you before it opens to everyone else.\n\nOpen SIGNL to apply: https://app.joinsignl.com` };
    case "creator_booked":
      return { subject: `You were picked: ${title}`, sms: `SIGNL: You were picked for "${title}" at ${biz}. Your visit code is in My Visits in SIGNL.`, email: `You were picked on SIGNL.\n\n"${title}" at ${biz} is booked for you. Your visit code is in My Visits; redeem it at the visit and post within 48 hours.\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "post_clock_started":
      return { subject: `Your 48-hour post clock is running: ${biz}`, sms: `SIGNL: Your visit to ${biz} is redeemed and your post clock is running.${deadline} Paste your post link in SIGNL when it is up.`, email: `Your visit to ${biz} was redeemed, so your post clock is running.${deadline}\n\nPost honestly, disclose the comp, then paste the post link in SIGNL under My Visits.\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "post_clock_12h":
      return { subject: `About 12 hours left on your post clock: ${biz}`, sms: `SIGNL: About 12 hours left to post about ${biz}.${deadline} Paste the link in SIGNL as soon as it is up.`, email: `About 12 hours are left on your post clock for ${biz}.${deadline}\n\nA post inside the week still counts, but on time is what builds your track record. Paste the link in SIGNL under My Visits.\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "licence_waiting_creator":
      return { subject: `A licence request is waiting on you`, sms: `SIGNL: ${biz} wants to license your post for 90 days of repost and ad use${payload.feeText ? ` at your ${payload.feeText} fee` : ""}. It is waiting on your yes or no in SIGNL.`, email: `A licence request is waiting on you in SIGNL.\n\n${biz} wants to license your post from your visit for 90 days of reposting and ad use${payload.feeText ? `, at your ${payload.feeText} licensing fee (you keep 97%)` : ""}. Nothing is licensed unless you approve it.\n\nDecide in SIGNL: https://app.joinsignl.com` };
    case "business_applications_waiting":
      return { subject: `Applications are waiting: ${title}`, sms: `SIGNL: ${payload.creatorName || "A creator"} applied to "${title}". Applications are waiting in your stack in SIGNL.`, email: `Applications are waiting on SIGNL.\n\n${payload.creatorName || "A creator"} applied to "${title}". Picking inside the window keeps things moving; nobody should be left waiting without an answer.\n\nOpen your stack in SIGNL: https://app.joinsignl.com` };
    case "business_licence_waiting":
      return { subject: `Your licence request moved`, sms: `SIGNL: The licence state you were waiting on has moved. Open SIGNL to see where it stands.`, email: `The licence request you were waiting on has moved in SIGNL.\n\n${payload.detail || "Open SIGNL to see the current state."}\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "licence_expiring":
      return { subject: `A licence ends ${payload.endsOn || "soon"}: ${payload.creatorName || "a creator"}'s post`, sms: `SIGNL: Your licence on ${payload.creatorName || "a creator"}'s post ends ${payload.endsOn || "soon"}. Ask to renew in SIGNL: the creator approves a fresh 90 days at their listed fee. Nothing renews on its own.`, email: `A licence you hold is ending.\n\nYour licence on ${payload.creatorName || "a creator"}'s post (${payload.postTitle || "a visit post"}) ends ${payload.endsOn || "soon"}. After that day you can no longer repost it or run it as an ad.\n\nTo keep using it, ask to renew in SIGNL: the request goes to the creator at their listed fee, and a fresh 90 days starts only if they approve. Nothing renews on its own, and no licence ever runs longer than 90 days.\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "roster_drop":
      return { subject: `New creators finished in your market`, sms: `SIGNL: ${payload.count ? `${payload.count} new creator${payload.count === 1 ? "" : "s"}` : "New creators"} finished their profiles${payload.market ? ` in ${payload.market}` : ""}. See them in SIGNL.`, email: `New creators finished on SIGNL.\n\n${payload.count ? `${payload.count} new creator${payload.count === 1 ? "" : "s"}` : "New creators"} finished their profiles${payload.market ? ` in ${payload.market}` : ""}${payload.category ? ` (${payload.category})` : ""}. They are ranked by local audience, not follower count.\n\nSee them in SIGNL: https://app.joinsignl.com` };
    case "creator_deal_new":
      return { subject: `A deal is waiting on you: ${title}`, sms: `SIGNL: ${biz} sent you a deal: "${title}"${payload.amountText ? ` at ${payload.amountText}` : ""}. It expires ${payload.expiresText || "soon"}. Open SIGNL to accept, counter, or decline.`, email: `A business sent you a structured deal on SIGNL.\n\n${biz} sent: "${title}"${payload.amountText ? ` at ${payload.amountText}` : ""}. No messages needed: accept it, counter it once, or decline with a tap. It expires ${payload.expiresText || "in 48 hours"}, and expiring costs you nothing.\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "creator_deal_countered":
      return { subject: `A counter is waiting on you: ${title}`, sms: `SIGNL: ${biz} countered your deal: "${title}"${payload.amountText ? ` at ${payload.amountText}` : ""}. It expires ${payload.expiresText || "soon"}. Open SIGNL to answer.`, email: `${biz} countered your deal on SIGNL.\n\n"${title}"${payload.amountText ? ` now stands at ${payload.amountText}` : ""}. Accept it, counter back once, or decline with a tap. It expires ${payload.expiresText || "in 48 hours"}.\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "business_deal_countered":
      return { subject: `A counter is waiting on you: ${title}`, sms: `SIGNL: ${payload.creatorName || "The creator"} countered your deal: "${title}"${payload.amountText ? ` at ${payload.amountText}` : ""}. It expires ${payload.expiresText || "soon"}. Open SIGNL to answer.`, email: `${payload.creatorName || "The creator"} countered your deal on SIGNL.\n\n"${title}"${payload.amountText ? ` now stands at ${payload.amountText}` : ""}. Accept it, counter back once, or decline with a tap. It expires ${payload.expiresText || "in 48 hours"}.\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "creator_deal_resolved":
      return { subject: `Your deal moved: ${title}`, sms: `SIGNL: ${payload.text || `Your deal "${title}" with ${biz} moved.`} Open SIGNL to see where it stands.`, email: `${payload.text || `Your deal "${title}" with ${biz} moved.`}\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "business_deal_resolved":
      return { subject: `Your deal moved: ${title}`, sms: `SIGNL: ${payload.text || `Your deal "${title}" moved.`} Open SIGNL to see where it stands.`, email: `${payload.text || `Your deal "${title}" moved.`}\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "creator_deal_expired":
      return { subject: `A deal expired: ${title}`, sms: `SIGNL: The deal "${title}" from ${biz} expired unanswered. Nothing is owed either way; their listed-rate booking is still there if you want it.`, email: `A deal expired on SIGNL.\n\nThe deal "${title}" from ${biz} reached its deadline unanswered and closed on its own. Nothing is owed either way.\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "business_deal_expired":
      return { subject: `A deal expired: ${title}`, sms: `SIGNL: Your deal "${title}" expired unanswered and closed on its own. Nothing is owed either way.`, email: `A deal expired on SIGNL.\n\nYour deal "${title}" reached its deadline unanswered and closed on its own. Nothing is owed either way; you can send a fresh deal or book at the listed rate any time.\n\nOpen SIGNL: https://app.joinsignl.com` };
    case "creator_match_alert":
      return { subject: `An open offer matches your alerts: ${title}`, sms: `SIGNL: An open offer matches your alerts: "${title}" at ${biz}. Open SIGNL to see it and apply.`, email: `An open offer matches the alerts you set.\n\n${biz} posted: "${title}". It matches your saved alert preferences (category, value, or rate). Open SIGNL to see it and apply: https://app.joinsignl.com` };
    case "creator_coupon_expired":
      return { subject: `A coupon reached its expiry: ${biz}`, sms: `SIGNL: The coupon from ${biz} reached its expiry${payload.unspentText ? ` with ${payload.unspentText} unspent` : ""}. What you already spent stands; the rest is closed.`, email: `A coupon deal reached its expiry.\n\nThe coupon from ${biz} expired${payload.unspentText ? ` with ${payload.unspentText} of its value unspent` : ""}. Whatever you already spent stands; the unspent rest is closed, and both sides' wallets show exactly that.\n\nOpen SIGNL: https://app.joinsignl.com` };
    default:
      return { subject: "SIGNL update", sms: `SIGNL: ${payload.text || "You have an update in SIGNL."}`, email: payload.text || "You have an update in SIGNL." };
  }
}

// ---------- provider config (env-only) ----------
function smsConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}
function emailProvider() {
  const sel = String(process.env.NOTIFY_EMAIL_PROVIDER || "").toLowerCase();
  if (sel === "postmark" && process.env.POSTMARK_SERVER_TOKEN) return "postmark";
  if (sel === "resend" && process.env.RESEND_API_KEY) return "resend";
  // Build -132: Resend is the DEFAULT email provider (Jeff's
  // P0-1 pick): a RESEND_API_KEY alone turns the email leg live,
  // no selector needed, so the rail flips by env alone once the
  // accounts exist. An explicit NOTIFY_EMAIL_PROVIDER=postmark
  // still wins when its token is set (handled above).
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.POSTMARK_SERVER_TOKEN) return "postmark";
  return null; // sandbox
}
function providerStatus() {
  return {
    sms: smsConfigured() ? "twilio" : "sandbox",
    email: emailProvider() || "sandbox",
    sandbox: !smsConfigured() && !emailProvider(),
  };
}

async function transmitSms(to, text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const body = new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`twilio_${res.status}:${(data && data.message) || ""}`.slice(0, 200));
  return data.sid || null;
}

async function transmitEmail(to, subject, text) {
  const provider = emailProvider();
  const from = process.env.NOTIFY_EMAIL_FROM || "SIGNL <hello@joinsignl.com>";
  if (provider === "resend") {
    const fromAddr = (from.match(/<([^>]+)>/) || [null, from])[1];
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from.includes("<") ? from : `SIGNL <${fromAddr}>`, to: [to], subject, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`resend_${res.status}`.slice(0, 200));
    return data.id || null;
  }
  // postmark
  const fromAddr = (from.match(/<([^>]+)>/) || [null, from])[1];
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ From: fromAddr, To: to, Subject: subject, TextBody: text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`postmark_${res.status}:${(data && data.Message) || ""}`.slice(0, 200));
  return data.MessageID || null;
}

// ---------- the one call ----------
async function recordOutbox(entry) {
  await store.set(`notifyoutbox:${entry.id}`, entry);
  return entry;
}

async function notify(user, eventType, payload = {}) {
  const def = EVENT_TYPES[eventType];
  if (!user || !user.id) return { ok: false, reason: "no_recipient", entries: [] };
  if (!def) return { ok: false, reason: "unknown_event", entries: [] };
  const rendered = render(eventType, payload);
  const base = {
    userId: user.id, role: user.role || null, eventType, prefKey: def.prefKey,
    createdAt: new Date().toISOString(),
  };
  const entries = [];
  const mk = (channel, to, extra) => ({ id: crypto.randomUUID(), ...base, channel, to: to || null, ...extra });

  // Tester fence first: never transmitted, whatever the prefs say.
  if (isTester(user)) {
    entries.push(await recordOutbox(mk("sms", phoneOf(user) || null, { text: rendered.sms, status: "fenced_tester", sandbox: !smsConfigured(), transmitted: false, reason: "tester_account" })));
    entries.push(await recordOutbox(mk("email", user.email || null, { subject: rendered.subject, text: rendered.email, status: "fenced_tester", sandbox: !emailProvider(), transmitted: false, reason: "tester_account" })));
    return { ok: true, fenced: true, entries };
  }
  // Per-type preference: OFF suppresses this type only.
  if (!prefEnabled(user, eventType)) {
    entries.push(await recordOutbox(mk("sms", phoneOf(user) || null, { text: rendered.sms, status: "suppressed_pref", sandbox: !smsConfigured(), transmitted: false, reason: `pref_${def.prefKey}_off` })));
    entries.push(await recordOutbox(mk("email", user.email || null, { subject: rendered.subject, text: rendered.email, status: "suppressed_pref", sandbox: !emailProvider(), transmitted: false, reason: `pref_${def.prefKey}_off` })));
    return { ok: true, suppressed: true, entries };
  }

  // SMS leg.
  const phone = phoneOf(user);
  if (!phone) {
    entries.push(await recordOutbox(mk("sms", null, { text: rendered.sms, status: "no_phone", sandbox: !smsConfigured(), transmitted: false, reason: "no_phone_on_record" })));
  } else if (!smsConfigured()) {
    entries.push(await recordOutbox(mk("sms", phone, { text: rendered.sms, status: "sandbox", sandbox: true, transmitted: false })));
  } else {
    try {
      const ref = await transmitSms(phone, rendered.sms);
      entries.push(await recordOutbox(mk("sms", phone, { text: rendered.sms, status: "sent", sandbox: false, transmitted: true, providerRef: ref })));
    } catch (e) {
      entries.push(await recordOutbox(mk("sms", phone, { text: rendered.sms, status: "failed", sandbox: false, transmitted: false, reason: String(e && e.message || e).slice(0, 200) })));
    }
  }
  // Transactional email leg.
  if (!user.email) {
    entries.push(await recordOutbox(mk("email", null, { subject: rendered.subject, text: rendered.email, status: "no_email", sandbox: !emailProvider(), transmitted: false, reason: "no_email_on_record" })));
  } else if (!emailProvider()) {
    entries.push(await recordOutbox(mk("email", user.email, { subject: rendered.subject, text: rendered.email, status: "sandbox", sandbox: true, transmitted: false })));
  } else {
    try {
      const ref = await transmitEmail(user.email, rendered.subject, rendered.email);
      entries.push(await recordOutbox(mk("email", user.email, { subject: rendered.subject, text: rendered.email, status: "sent", sandbox: false, transmitted: true, providerRef: ref })));
    } catch (e) {
      entries.push(await recordOutbox(mk("email", user.email, { subject: rendered.subject, text: rendered.email, status: "failed", sandbox: false, transmitted: false, reason: String(e && e.message || e).slice(0, 200) })));
    }
  }
  try {
    await logEvent({ type: "notify_dispatched", actorId: null, actorRole: "system", subjectId: user.id, market: user.market || null, data: { eventType, prefKey: def.prefKey, channels: entries.map((e) => `${e.channel}:${e.status}`) } });
  } catch (e) { /* the outbox is the record; the event is a bonus */ }
  return { ok: true, entries };
}

// Convenience for callers that hold only an id (the router's
// milestone sites): loads the record, then the one call above.
async function notifyById(userId, eventType, payload = {}) {
  const user = await store.get(`user:${userId}`);
  if (!user) return { ok: false, reason: "no_recipient", entries: [] };
  return notify(user, eventType, payload);
}

// ---------- the ~12h post-clock sweep ----------
// Post deadlines live on the booking: redeemedAt starts the
// clock, postDeadline is when the 48h window ends. A booking
// with no post whose deadline is within the next 12 hours (and
// not yet past) gets exactly one post_clock_12h alert: the
// booking is stamped (notify12hAt) BEFORE the send completes,
// so a re-run — or a crash mid-run — never double-fires.
const TWELVE_HOURS_MS = 12 * 3600 * 1000;
async function runPostClockSweep(opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const summary = { checked: 0, fired: 0, alreadyStamped: 0, fenced: 0, suppressed: 0 };
  const bookings = (await store.list("booking:")).map((r) => r.value).filter(Boolean);
  const posts = (await store.list("post:")).map((r) => r.value).filter(Boolean);
  const postByBooking = new Set(posts.map((p) => p.bookingId));
  for (const booking of bookings) {
    if (!booking.redeemedAt || !booking.postDeadline) continue;
    if (booking.status === "completed" || booking.honorReportedAt) continue;
    if (postByBooking.has(booking.id)) continue;
    const deadlineMs = Date.parse(booking.postDeadline);
    if (Number.isNaN(deadlineMs)) continue;
    summary.checked += 1;
    if (booking.notify12hAt) { summary.alreadyStamped += 1; continue; }
    const remaining = deadlineMs - now;
    if (remaining <= 0 || remaining > TWELVE_HOURS_MS) continue;
    booking.notify12hAt = new Date(now).toISOString();
    await store.set(`booking:${booking.id}`, booking);
    const creator = await store.get(`user:${booking.creatorId}`);
    if (!creator) continue;
    const result = await notify(creator, "post_clock_12h", {
      businessName: booking.businessName || "the business",
      deadlineText: new Date(deadlineMs).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET",
    });
    if (result.fenced) summary.fenced += 1;
    else if (result.suppressed) summary.suppressed += 1;
    else summary.fired += 1;
  }
  return summary;
}

async function listOutbox(limit = 200) {
  const rows = (await store.list("notifyoutbox:")).map((r) => r.value).filter(Boolean);
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return rows.slice(0, Math.max(1, Math.min(1000, limit)));
}

module.exports = { notify, notifyById, render, clockPrefsOf, prefEnabled, defaultPrefs, EVENT_TYPES, PREF_KEYS, providerStatus, smsConfigured, emailProvider, runPostClockSweep, listOutbox, phoneOf };
