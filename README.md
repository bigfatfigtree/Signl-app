# SIGNL App (app.joinsignl.com)

The public, production SIGNL platform. Local businesses comp local
creators a meal or service; creators post honestly within 48 hours;
every visit and post is tracked. This is the deployable successor to
the private "SIGNL Platform Core" staging artifact: same flows, same
data model, real self-serve accounts.

Stack: static SPA (public/) + one Netlify Function (netlify/functions/)
+ Netlify Blobs storage. No other services, no new paid accounts.

## Launch shape (Jeff, 2026-10-18)

The public launch is **creator founding sign-up only**:

- **Creators** register with a complete profile (below) and, once
  approved, land on a **Founding Creator status page** for their
  market: their profile, their founding priority position, and the
  launch message. Markets open to businesses in the next **60 to 90
  days**; SIGNL emails creators at the address they registered with
  when their market opens; early sign-ups get priority when businesses
  search (discovery's default sort is sign-up order).
- **Businesses cannot create accounts.** The app's For Businesses page
  sends them to the founding business list on joinsignl.com, where
  joining locks in founding pricing ($299/mo Self-Service, $599/mo
  Growth, $999/mo Managed, 3-month minimum). Business accounts open per market at
  launch. All business functionality (discovery, offers, counter,
  plans) remains in the codebase, gated off.
- **Market activation is a per-market admin flag** (Admin, Markets
  tab), default OFF for all 39 markets. Until a market is live, its
  approved creators see only the founding status page, and discovery,
  offers, bookings, the counter, posts, and messages refuse with the
  launch-window message.
- **Markets are country-grouped and universal (2026-10-18).** There
  are 39 markets across 12 countries and territories: the 11 US
  founding metros (unchanged names, city lists, and flags), 12 more
  US single-city markets (Nashville, Austin, Dallas, Chicago, Los
  Angeles, San Diego, Seattle, Tampa, Miami, Phoenix, Denver,
  Minneapolis), London and Manchester (United Kingdom), Dubai and
  Abu Dhabi (United Arab Emirates), Riyadh (Saudi Arabia), Doha
  (Qatar), Astana (Kazakhstan), Bishkek (Kyrgyzstan), Sydney,
  Melbourne, and Perth (Australia), Auckland (New Zealand), Singapore,
  Hong Kong, and Beijing and Shanghai (China). Each market record
  carries a `country`, which the API/bootstrap exposes; the sign-up
  picker is a search box plus a select grouped by country (United
  States first, then alphabetical; cities alphabetical within a
  country), with "My city is not listed yet" last. Dubai is a core
  market in that picker, never a typed-in fallback. Every market,
  new and founding, defaults to NOT live: founding sign-ups are open
  everywhere, and offers stay gated per market until an admin
  activates it.
- **The creator roster is never public.** No public roster pages
  exist; discovery requires an authenticated, approved business
  account in a live market. The one exception, added 2026-10-19: each
  **approved** creator has a single shareable public profile page at
  `app.joinsignl.com/c/<handle>` (their own link to advertise, never
  a listing or an index). It serves a strict whitelist of public-safe
  fields (see below); pending and rejected creators answer 404 there,
  exactly like unknown handles. Photo rule (changed 2026-10-19 with
  the richer profiles): an **approved** creator's photo is part of
  their public profile and is served without sign-in; a pending or
  rejected creator's photo stays locked to the owner, the admin, or
  an approved business in a live market.

## What is implemented

- Real registration (email + password, scrypt-hashed). Accounts start
  as **pending**; the admin approves or rejects before an account can
  use the app.
- Admin account (jeff@joinsignl.com) with an applications queue
  (founding priority and queue positions shown per creator), a Markets
  tab for activation, an event log viewer, and per-market stats.
- **Creator registration is the full founding profile builder.**
  Required: full name, email, password, market, home city (must be in
  that market's published city list), Instagram handle, follower
  count, at least one content category (Food & Drink, Nightlife,
  Beauty & Grooming, Fitness & Wellness, Health & Wellness,
  Retail & Shopping,
  Attractions & Events, Local Services, Other), self-reported local
  audience percentage (always labeled "Self-reported" until Meta
  verification exists), and both acknowledgments: the honest-post rule
  (no business can require a positive post) and the FTC disclosure
  agreement. Optional: TikTok handle, YouTube channel, Facebook
  profile/Page URL, X handle or URL, LinkedIn profile URL, typical
  post views, top audience cities (up to 5), comps they would accept,
  bio, and a profile photo (PNG/JPEG/WebP up to 2.5 MB, stored in
  Blobs). The tier band (Neighbors 500-2k, Locals 2k-15k, Creators
  15k+) is FULLY AUTOMATIC: it is computed from the creator's stacked
  total audience across platforms, at sign-up and on every profile
  save. Nobody picks or confirms their own band; the sign-up form
  shows it as a read-only line that follows the counts, and any tier
  value a client sends is ignored server-side. Social inputs are
  normalized to canonical URLs (a bare
  Facebook page name becomes facebook.com/..., an X URL becomes the
  handle plus x.com/..., a LinkedIn slug becomes linkedin.com/in/...).
- Local Impact Score computed only from stored inputs (formula below).
- **Claim-link prefill (2026-10-19).** The sign-up form honors
  `?handle=<ig>&market=<name>&tier=<band>` (alongside the existing
  `?ref=` referral credit), so per-target links from email and
  partner channels land on a half-completed application. Params are
  sanitized client-side (handle charset + length caps, market and
  tier by exact match against the bootstrap lists, anything else
  silently ignored); they only fill fields, never submit, and never
  bypass the human review. The ?tier= param is still accepted and
  validated, but it no longer sets the band: tier bands are fully
  automatic from the stacked total (above). DM copy is unchanged:
  DMs still carry the generic link.
- **Public creator profiles (2026-10-19).** `GET /api/c/<handle>`
  answers logged-out visitors with a whitelist payload for an
  approved creator: display name, handle + Instagram URL, photo URL,
  market (or typed city for unlisted creators), city,
  neighborhood/area, tier band, follower count, content categories,
  comp categories, local audience % with its source label, Local
  Impact Score when computable, Momentum points, and the banded
  founding standing ("in the first 100 in <market>"). Since the
  richer-profiles build (below) it also carries the creator's best
  work links, their SIGNL track record, and any business reviews.
  Never the email, never internal or admin fields. The SPA renders it
  at `/c/<handle>` for logged-out and signed-in visitors alike, and
  approved creators get a "Your public profile" link + copy button in
  their profile.
- Business discovery: browse approved creators in a market and search
  them the way businesses actually shop (spec:
  `signl-business-search-spec.md` in the SIGNL goal workspace). Filters,
  all server-side over stored fields: market, neighborhood/area text
  match, tier band, content category, comp category fit, follower
  range, minimum local audience %, open-to-paid-campaigns, name/handle
  text. Sorts: founding order (default), Local Impact Score, Momentum
  points. Creators carry an optional free-text `neighborhood` (their
  area inside their home city), collected at sign-up and editable in
  the profile.
- Offers: targeted (to one creator) or open (whole market), with an
  exact "what is comped" description, a dollar cap, a visit window,
  and a spot count. Creators accept (booking) or decline.
- Bookings issue a unique single-use code (SGNL-XXXXXX) plus a QR code
  that opens the business Counter with the code filled in.
- Redemption happens in the app, never in the business's POS: the
  business Counter looks up the code, shows the creator and the cap,
  and one tap burns the code and starts the 48 hour post clock.
  Fallbacks from the redemption spec are built: the creator can tap
  "I am here" and the business can confirm the visit in the dashboard;
  a post cannot be submitted before a visit is redeemed.
- Post tracking: the creator submits the post URL with an FTC
  disclosure confirmation; the system records on-time vs late against
  the deadline, and the business verifies the post is live. Overdue
  posts can trigger a replacement request.
- Messaging between a business and a creator, both directions.
- Business plans: Self-Service $299/mo, Growth $599/mo, and Managed
  $999/mo, 3-month minimum, then month to month (see the 2026-10-19
  section below for what each plan's content rights are). Plan selection is recorded at registration and can be
  changed in the Plan tab. **Founding billing placeholder:** no card is
  charged and nothing pretends otherwise; the recorded plan and the
  honest billing status are stored on the account. Stripe checkout is
  the later wiring step. (At launch this whole path is gated off with
  the rest of the business side; founding businesses lock the same
  prices via the list on joinsignl.com.)
- Event-level data capture on every state change (full list below).
  This dataset is the asset: keep it that way.

## Local development and verification

```
npm install
SIGNL_LOCAL=1 ADMIN_PASSWORD='choose-a-password' npm run dev
# http://localhost:8899  (admin: jeff@joinsignl.com / the password above)
```

Verification (each suite spins up its own throwaway server and
database, and registers fresh accounts through the real sign-up path):

```
node scripts/verify-flow.mjs        # 98 checks: main marketplace flow
node scripts/verify-fallbacks.mjs   # 14 checks: check-in / confirm fallbacks
node scripts/verify-launch.mjs      # 210 checks: the launch shape itself
node scripts/verify-compliance.mjs  # 112 checks: stacking, compliance, Momentum v2, round-2 ops
node scripts/verify-campaign.mjs    # 119 checks: creator outreach campaigns (stub mailer only)
node scripts/verify-paidlane.mjs    # 58 checks: paid lane, creator reviews, review links, Managed budget
npm run verify                      # all six, in order (611 total)
```

`verify-launch.mjs` runs in true production shape: business
registration refused, all markets founding-only, the full profile
builder enforced field by field, a creator registered with **all six
social fields filled** (Instagram, TikTok, YouTube, Facebook, X,
LinkedIn) and confirmed to persist and display on the founding card,
the roster invisible to anonymous visitors, founding priority in
sign-up order, and the marketplace opening only when an admin
activates the market.

The two marketplace suites set `SIGNL_TEST_ALLOW_BUSINESS=1`, a
**test-only** server flag that re-opens business registration and
treats every market as live so the gated flows can still be exercised
end to end. It is read from the environment only, is not in
netlify.toml, and must never be set on the Netlify site.

All six suites were run green against this codebase on 2026-10-19
(611 checks total, including the Momentum points math end to end:
a recruiter with 2 credited sign-ups and 1 approval earns 16
REFERRAL points (their full total also counts their own profile
entries, for example +5 for reporting a local audience percentage,
so the launch scenario recruiter's full total is 21); the Business
Preview isolation checks and the business review round-trip
described below are covered too. verify-compliance.mjs time-travels
a throwaway DB (seed redemption timestamps in the past, reboot, run
the sweep) to prove the whole compliance ladder deterministically.

## 2026-10-18 post-launch changes (Jeff's screenshot review)

- Mobile nav is an app-style fixed bottom tab bar under 720px; the top
  link row is desktop-only (it wrapped and broke on phones).
- Creators tier (15k+) can opt into "Paid cash campaigns" on top of
  comps, at sign-up and in profile edit. Enforced server-side; dropping
  out of the Creators tier removes the option. Businesses see an
  "Open to paid campaigns" badge on the creator card.
- Creator-facing founding standing is BANDED: "in the first 100" (then
  200, 300...). Exact queue positions and market signup counts are
  never sent to creator or business clients; they remain in admin
  responses and the event log, so exact display can return later.
- Sign-up requires agreeing to the Terms of Service + Privacy Policy
  and to account/marketing emails (checkbox, stored with terms version
  2026-10-18 and timestamps, on the user record and in events).
- Two transactional emails: sign-up confirmation and approval notice
  (auto-triggered by the admin approve action). Both are logged as
  *_email_queued events, then *_email_sent or *_email_not_sent. They
  send only when the SMTP env vars above are set.
- "My city is not listed yet" sign-ups: the market picker gains that
  option; the creator types their own city + country (state/province
  optional) and completes the full founding profile under the
  pseudo-market "Not listed yet" (user.country holds the country;
  user.state keeps an optional state/province, and older records that
  only have a state still display and rank). Standing bands rank per
  typed city + country. Pending, founding-status and both emails have
  unlisted variants ("your sign-up counts toward opening your city").
  Admin Stats shows unlistedByCity: sign-ups per outside city +
  country, biggest first, the demand signal for choosing the next
  market.
- Universal markets (later on 2026-10-18): 28 single-city core
  markets added across 12 countries and territories (see Launch
  shape), every market record gained a `country`, the sign-up picker
  became a search box over a country-grouped select, and creator
  categories gained a Health & Wellness content category plus a
  "Health & wellness services" comp category (med spa treatments,
  vein clinic services, dental, dermatology and aesthetics, IV
  therapy). Listed-market accounts store the market's country on the
  user record.

## Momentum: referral points + roster standing (2026-10-18)

Creators earn standing for recruiting. Points are computed server-side
from stored sign-up records only (`lib/router.js`, `momentumMap` /
`momentumFor`): **+3 for every account whose `referredBy` credits the
creator's handle, +10 more for each credited creator who is
approved.** Nothing is estimated or self-reported.

- The creator's own payload (register, login, `/api/auth/me`, profile
  updates) carries `momentum: { signups, approved, points }`, and the
  "Grow your roster" block (pending, founding status, dashboard
  Profile tab) shows the roster count, approved count, points, and
  the rule in plain words: "Creators who build a roster get seen
  first when businesses start choosing in your market. Points: +3
  when a creator joins through your link, +10 when they are
  approved."
- Admin: `/api/admin/applications` carries `momentum` per creator,
  and the **Recruiters** tab renders `/api/admin/leaderboard`
  (handle, market, sign-ups, approved, points, best first).
- Both transactional emails (sign-up confirmation and approval,
  listed and unlisted variants) carry the same benefits block: the
  personal invite link, the credited roster, the +3/+10 points, and
  "A bigger roster moves you up: when businesses in your market start
  choosing creators, roster standing is part of the order they see."
- **One-time recruiter kit email.** The recruiter ask goes by email
  from the app, never by Instagram DM. On the first API request after
  the deploy that shipped it, the handler claims the blob flag
  `config:recruiterKitEmailV1Sent` and emails every currently
  approved creator exactly once (subject "Your Founding Creator
  badge is ready": badge links hosted on joinsignl.com under
  `/assets/badges/`, invite link, benefits block, optional story
  ask, no-pressure close, signed by Jeff). Each send is logged as
  `recruiter_kit_email_queued` / `_sent` / `_not_sent` events, plus
  one `recruiter_kit_email_run` summary event. The flag is claimed
  before sending, so it can never repeat.

## Business Preview + richer creator profiles (2026-10-19)

Two builds Jeff ordered so the platform can be test-driven as a
business and so creator profiles sell the connection the way the big
platforms' profiles do, without inventing anything.

**Business Preview (admin-only).** The admin console carries a
"Preview as business" entry. Preview walks the real business
journey in four steps: (1) the founding plans screen ($299
Self-Service / $599 Growth / $999 Managed, pick a plan and a market), (2) Discover
with the complete live filter set (market, neighborhood, category,
comp category, tier, follower range, min local %, paid-only, and the
founding / Impact Score / Momentum sorts), (3) the full rich creator
profile, (4) the offer composer. A PREVIEW banner rides every
preview screen and each step is badged; Exit preview (or any
navigation) returns to the admin console. Server side:
`GET /api/admin/preview/discover` runs the **identical**
`discoverCards()` query the real business surface uses, minus the
market-live gate, so any market can be test-driven before it opens;
`GET /api/admin/preview/creator/:id` returns the full rich card.
Offers are **simulated**: `POST /api/admin/preview/offers` validates
exactly like the real composer and returns a confirmation object
flagged `preview: true`, but it writes **nothing** to the store and
logs **no event** (client-side session list only). A preview offer
can therefore never reach a creator, a count, or a metric; the
verify suites prove it (creator offer list unchanged, admin stats
`offers` unchanged, zero `offer_created` events) in both the launch
shape and the live-marketplace shape. This is also how the admin
preview path is verified without the production admin password: the
launch suite signs in as the env-bootstrapped admin against a
throwaway local database and exercises the real endpoints.

**Business Preview dashboard (admin-only).** The preview also
carries a Dashboard view (Admin → Preview as business → Dashboard,
or the "Business dashboard" button on the admin console):
`GET /api/admin/preview/dashboard` builds, per request and entirely
in memory, one simulated business ("Salt & Ember Kitchen", Growth
plan, Hampton Roads) with five bookings across the real approved
roster covering the full visit lifecycle: booked with the
SGNL-XXXXXX credential issued (code + rendered QR of the counter
URL, redemption window), redeemed via staff scan with the 48 hour
post clock counting down live, posted on time with reported
performance (views/likes) and a 5-star business review, posted late
but delivered with a 4-star review, and one problem booking
redeemed via the business-confirm fallback and sitting in the late
window (deadline passed, hard stop ahead, replacement affordance
shown disabled). Featured creators (Emily, Kesha, Moni,
Christopher) fill the slots first; any approved roster creator can
cover a slot. Simulated codes are generated for display and checked
read-only against the live code index so one never equals a real
code. The top summary is the business's tracking + returns: visits
used vs the plan allowance, posts delivered, on-time rate, total
content views, comp value given (modeled at the business's own
cost) vs media value received (modeled at a $22 CPM on reported
views) with the modeled return multiple, and the plan's content
rights recap. A read-only Counter panel shows what staff see at
redemption, including the burned-code response and the no-code
confirm fallback. Every booking carries its Standard Visit
checklist. The route holds the preview invariant absolutely: it
reads users and the code index and writes nothing (no store writes,
no events, no metrics); the launch suite asserts the event log and
admin stats are byte-identical across the call, that simulated
bookings and codes appear in no real bookings list, and that the
route is admin-only (403 creator / 401 signed-out).

**Richer creator profiles.** One showcase, rendered identically on
the public profile page, the discovery card, the full profile view,
the creator's own profile ("How businesses see your profile"), and
the preview profile:

- **Photo.** The creator's uploaded photo now appears on the public
  profile (see the photo rule in Launch shape). No photo renders as a
  brand-styled initial tile.
- **Best work.** Creators add up to 3 links in profile edit
  (`creator.bestWork`, validated by `validateBestWork` in
  `lib/router.js`: http/https only, 300 chars max, host must be
  Instagram, TikTok, or YouTube including the vm./vt. short domains).
  They render as labeled outbound link cards ("Watch: Instagram
  reel", platform from the host). No third-party embeds.
- **SIGNL track record.** Computed only from stored bookings and
  posts (`summarizeTrackRecord`): visits completed (bookings with a
  redemption), posts delivered, on-time %, and the distinct business
  names from redeemed bookings. Before any activity the honest zero
  state renders: "New to SIGNL: no visits yet. Founding creator,
  first 100 in <market>." Never invented numbers.
- **Business reviews (plumbing).** `POST /api/bookings/:id/review`:
  a business can leave ONE review per booking it owns once the
  booking is completed (post in): `{ stars: 1-5, comment?: <=500
  chars }`, stored as `review:{uuid}` { bookingId, creatorId,
  businessId, businessName (snapshot), stars, comment, createdAt }
  and logged as `business_review_left`. Profiles display the average
  + count and the review list (stars, comment, business name, date)
  **only when a real review exists**. There is deliberately no
  business-facing entry UI yet; it ships with business accounts.
  Nothing is seeded, ever.

The discovery query itself was refactored into `discoverCards()` so
the real surface and the preview can never drift apart.

## 2026-10-19: stacking, the Standard Visit, compliance, Momentum v2, round-2 ops

**Audience stacking.** A creator's audience is the sum of their
platforms. The profile carries per-platform counts for Instagram,
TikTok, Facebook, X, LinkedIn, and YouTube (`creator.audienceStack`,
self-reported, capped at 100,000,000 per platform), and the server
computes `creator.totalAudience`. `followerCount` now means the
Instagram count; a profile with no stack falls back to treating its
stored followerCount as the Instagram count, so legacy profiles lose
nothing. Tier bands derive from the total, FULLY AUTOMATICALLY
(Jeff, 2026-10-19 01:46): sign-up and profile saves alike set the
band to `tierForFollowers(totalAudience)` (also stored as
`computedTier`); a tier value sent by any client, including the
claim-link ?tier= prefill, is ignored, and both forms show the band
as a read-only line that follows the counts. Discovery follower min/max
filters read the total, and every surface (public profile, discovery
card, full profile, preview, the creator's own profile) renders the
total plus the per-platform breakdown. Local audience % and the Local
Impact Score are unchanged (the % stays Instagram-based).

**The Standard Visit and the rights ladder.** One package for every
visit, defined once server-side (`STANDARD_VISIT` in lib/router.js)
and shipped in bootstrap, on public profiles, and on discovery cards
as "Every SIGNL visit includes": 1 post or reel + 2 stories within
48 hours of the visit, honest and disclosed, live at least 30 days,
tracked delivery proof. What the business may do with the post
follows the BUSINESS'S PLAN, and the creator's offer checklist states
that plan's rights before they accept (`visitRightsForPlan`, attached
to each offer as `visitRights`): Self-Service ($299/mo, up to 8
visits/mo) shares natively with the creator tagged, nothing more.
Growth ($599/mo, up to 20 visits/mo) adds own-feed reposts and ad use
while the account is active; the ad right ends when the account
ends. Managed ($999/mo, up to 30 visits/mo, coordinator-run) carries
Growth's rights plus the quarterly hero feature. Nobody, on any
plan, edits the creator's content. Paid hero campaigns (20% platform
fee) are a separate cash product, unrelated to these rights. Ad use
is an explicit action on a delivered post: `POST /api/posts/:id/ad-use`
(business, own post, Growth/Managed only, once per post) logs
`ad_use_declared`, notifies the creator in-app (a message in the
thread plus the visit card), and is worth +25 Momentum. The admin
preview has the same action as a simulation (`POST
/api/admin/preview/ad-use`): no event, no notification, no points.
The offer composer (real and preview) pre-loads the package summary
and offers comp suggestion chips by the target creator's tier and
redemption-window chips; the underlying offer fields are unchanged.

**Post compliance.** The check-off is the pasted Instagram post/reel
URL (host-validated like best-work links) in My Visits; a bare
checkbox earns nothing. The timeline lives in ONE config object
(`COMPLIANCE` in lib/router.js: visitWindowDays 7, onTimeHours 48,
hardStopDays 7, banFuseDays 7) and runs from redemption:

| When | What |
| --- | --- |
| Redemption | 48h post clock starts (postDeadline = redeemedAt + 48h) |
| Post within 48h | On time (+20 Momentum) |
| 48h, no proof | Friendly reminder email (post_reminder_1) |
| Post by day 7 | Delivered late (+5 and -10) |
| Day 5 | Second reminder (post_reminder_2) |
| Day 6 | Final warning: "your account pauses tomorrow" (post_reminder_3) |
| Day 7, no proof | PAUSED: greyed and sunk in discovery, blocked from accepting offers; the visit is recorded as a missed deadline (visit_deadline_missed, account_paused) |
| Days 7-14 (ban fuse) | A proof still lands: delivered late at +0 and -10, auto-unpauses; the missed-deadline mark stays on the track record and on-time % |
| Day 14, still no proof | BANNED: out of discovery entirely, public profile 404s, -50 Momentum (account_banned). Proof after the ban is recorded for the business but never auto-unbans |
| Any time | An admin can reinstate (POST /api/admin/compliance/reinstate, account_reinstated); the -50 stays on the record |

The engine is `runComplianceSweep()` in lib/router.js. It is driven
three ways: the Netlify scheduled function
`netlify/functions/compliance-sweep.mjs` (cron `23 */6 * * *`, POSTs
to the app's own endpoint with the `x-signl-sweep-token` header
matching the SIGNL_SWEEP_TOKEN env var), the admin endpoint `POST
/api/admin/compliance/sweep`, and an opportunistic throttled run
(about hourly, claimed via the `config:complianceSweep` record)
inside the request path. Every step is idempotent: markers are
stamped on the booking before the action fires. Admins watch it all
in the Compliance tab (`GET /api/admin/compliance`: visits by status
with creator, business, redeemed-at, deadline, hard stop, ban date,
proof link, standing, and reinstate buttons). Reminder emails send
from hello@ via the existing SMTP transport with the "The SIGNL
team" sign-off; when email is not configured they are logged as
`*_email_not_sent` events, never faked as sent. Sign-up now requires
the plain-language post-rule agreement (`agreedPostCompliance`,
terms version 2026-10-19): "Post within 48 hours for full credit.
One week is the hard stop."

**Momentum v2.** One currency, still computed server-side from
stored facts only (never a stored counter), floored at 0. Earn:
photo +10, bio (40+ chars) +5, neighborhood +5, local % reported +5,
stack of 3+ platforms +10, best work +5 per link (max +15), first
offer accepted +10, on-time post +20, late post (inside the week)
+5, 4-5 star business review +10, ad use +25 per post, post
performance report +5, every 5 consecutive on-time posts +25 streak
bonus, referrals +3 per sign-up and +10 per approved recruit. Lose:
late post -10 (on top of the +5, or on top of +0 inside the ban
fuse), no-show -25, redeemed-never-posted -50 (survives
reinstatement). The creator's own payload (`GET /api/auth/me`,
founding, admin applications) carries the full detail: total,
ledger (every entry with its date), and a ways-to-earn checklist
with live done/available state; discovery cards, public profiles,
and the leaderboard carry the summary (points, signups, approved).
Banned creators' totals freeze at ban time (earnings dated after
the ban do not count while banned); paused creators keep earning
from profile completion. Preview and simulated actions write no
records, so they can never mint points.

**Post-performance capture.** Seven days after a proof is
submitted, the sweep sends ONE email ("How did your post do?") and
stamps `post.performanceRequestedAt`. The creator reports views
and/or likes (`POST /api/bookings/:id/performance`, one report per
post) onto the post record (`views`, `likes`, `reportedAt`), worth
+5 Momentum once. Businesses see the numbers on their visit view;
the track record aggregates them as `contentViews` ONLY when at
least one post carries a reported figure (absent stays absent,
never zero-filled or estimated).

**Visit windows, not appointments.** An accepted offer carries a
redemption window: redeem any time within 7 days of accepting
(`windowMode: "7days"`, the default) or by the end of the current
week, Sunday (`windowMode: "thisweek"`), picked with the composer
chips. The booking stores `redeemBy`; the creator's visit card
shows "Use by <date>". No time slots exist anywhere. If the window
passes unused, the sweep expires the booking (`offer_expired`,
status expired, code dead) and Momentum treats it as the
accept-then-vanish no-show (-25). Bookings WITH a visit date still
no-show on the date rule; dateless, unexpired bookings are never
penalized.

**Staff notice.** When a creator taps "I am here" (check-in) or a
comp is redeemed (counter or business confirm), the business
immediately gets an email (`staff_notice_sent` event plus the
`staff_notice` delivery events): creator name and photo, what was
comped and the cap, the booking code, and one line on how
redemption works. One notice per trigger per booking. Preview mode
never reaches a redemption, so no preview notice can exist.

**Business-didn't-honor reports.** On a visit with no delivered
post, the creator can file "The business didn't honor this"
(`POST /api/bookings/:id/honor-report`, short reason required). It
logs `business_honor_report`, stamps the booking, and voids that
visit's compliance clock entirely: the sweep skips it, Momentum
skips it, and the track record does not count it as a completed
visit. The business record carries its running count
(`business.honorReports`), and the admin Compliance view aggregates
reports per business with a visible WARNING flag at two or more.
There is no public surface for any of this.

**Weekly visit cap.** A creator sets "Max visits per week" in
profile edit (`creator.maxVisitsPerWeek`, default 3, range 1-7).
The count is bookings accepted in the current Mon-Sun week that are
not cancelled or expired. At cap, offers still arrive, but
accepting is refused with a plain explanation, and discovery (card,
full profile, preview, public profile payload) flags the creator
`bookedUp: true` ("Booked up this week"): visible, not greyed.
That is deliberately different from paused.

## Creator outreach campaign (2026-10-19)

Jeff approved a founding-creator outreach email and wants it sent
without a per-send approval card. The Gmail connector pops a card
per send; the app's own SMTP transport (`lib/email.js`) does not.
So the campaign sends from inside the app, like its transactional
mail already does.

- **Queue.** `campaign:{id}` holds the config (`armed`, `armedAt`,
  `armedBy`, `lastError`, `lastRunAt`, `totalSent`, `disarmReason`);
  `campaign-recipient:{id}:{email}` holds one record per recipient
  (`email`, `name`, `handle`, `market`, `opener` — a short true
  personalization string — plus `status` queued/sent/bounced/
  skipped, `sentAt`, `messageRef`). The seed campaign id is
  `founding-creators-2026-10`. **The queue ships empty: no real
  recipients exist in code or seeds.** Recipients arrive only
  through the import endpoint below, from the skip-filtered harvest
  list.
- **Template.** Rendered server side (`campaignEmail()` in
  lib/router.js) with the recipient's slots; Jeff approved the copy
  on 2026-10-19. Subject: "A founding creator spot in {Market}".
  Greeting "Hi {FirstName}," (first token of the name; "Hi there,"
  when missing). Hampton Roads gets the November / Black Friday
  launch paragraph; every other market gets the founding-market
  paragraph (30 to 90 days, sign-up order). The claim link is
  prefilled per recipient (`?handle=&market=`). Sign-off is "Jeff",
  first name only. No em dashes.
- **Second campaign: platform crossover.** Campaign id
  `founding-crossover-2026-10`, same queue, engine, ceiling, and
  admin endpoints. It targets creators already working national
  platforms, and its template (`crossoverEmail()` in lib/router.js,
  dispatched per campaign by `campaignEmailFor()`) carries a
  different, additive pitch. Subject: "Your national platforms,
  plus a local layer in {Market}". The copy is explicit that SIGNL
  is non-exclusive and asks nobody to leave platforms like Grin,
  Cohley, or Momfluence; it sells the local layer on top: comps
  from businesses in their own city, honest posts within 48
  hours, a tracked public track record, and two local money
  routes (their own paid rate on their profile, of which they
  keep 97 percent while the business covers another 3 percent and
  SIGNL escrows the payment until the post is live; and 15k+
  creators first in line for paid cash campaigns), because SIGNL
  leads with the share of a creator's audience that lives in the
  business's market. Founding mechanics match the founding
  template (free profile, spot in sign-up order, same market
  paragraph, prefilled claim link). One extra import rule: an
  address the founding campaign already holds (any status) is
  recorded on the crossover campaign as `skipped` with
  `skipReason: cross_campaign` and reported in the import
  response's `crossCampaign` count, so no creator ever receives
  both outreach emails. Crossover recipients live under their own
  campaign keys and can only ever receive the crossover template.
- **Engine.** `netlify/functions/campaign-sweep.mjs` (Netlify
  scheduled function, every 30 minutes) POSTs to
  `POST /api/admin/campaign/sweep`, which sits in front of the
  sign-in wall and accepts the same `SIGNL_SWEEP_TOKEN` as the
  compliance sweep, or an admin session. `runCampaignSweep()` sends
  only when the campaign is armed AND the clock is inside the send
  window (08:00–21:00 America/New_York): the next batch of up to 8
  queued recipients, paced inside the run (`SIGNL_CAMPAIGN_PACE_MS`,
  default 400ms). Each successful send is stamped (`sentAt`,
  `messageRef`) and logged as a `campaign_email_sent` event. More
  than 2 failures in a run stops the run and sets `lastError`;
  failed recipients stay queued for a later retry, never burned.
  The campaign auto-disarms when its queue empties
  (`disarmReason: queue_empty`). Volume is governed by a GLOBAL
  daily ceiling, not a per-campaign cap: at most 40 campaign sends
  per America/New_York calendar day across ALL campaigns combined,
  because what the ceiling protects is the hello@ sending domain.
  The count is derived from the recipient records themselves (each
  successful send stamps `sentAt` on its own record), so there is
  no separate counter to drift or race. Reaching the ceiling is not
  an error: the sweep sends nothing more that day, campaigns stay
  armed, no `lastError` is set, and the Campaign tab shows "Sent
  today: X of 40 (daily ceiling)". A per-campaign lifetime backstop
  of 1,000 (`CAMPAIGN_RUNAWAY_BACKSTOP`,
  `disarmReason: runaway_backstop_reached`) exists purely as a bug
  guard and is never expected to bind.
- **Admin surface.** Admin → Campaign tab: one stacked section
  per campaign (founding, then crossover), each with its own
  counts by status, last error, recent sends, paste-import box,
  and Arm/Pause button, backed by
  `GET /api/admin/campaign` (status: `?campaignId=` optional),
  `POST /api/admin/campaign/import` (recipients array, max 500;
  dedupes by email; validates email shape and requires handle,
  market, and opener; addresses in the payload's `skipEmails` /
  `blocklist` arrays are recorded as `skipped`, never queued — the
  importer supplies the skips, there is no hardcoded blocklist),
  `POST /api/admin/campaign/arm` and `/disarm`. Arming happens only
  through the UI or these endpoints. All campaign routes are admin
  only (the sweep additionally accepts the sweep token).
- **Operating it.** Import the recipients (admin session), check
  the Campaign tab counts, then Arm. The 30-minute sweep does the
  rest inside the window until the queue drains, pacing itself
  across days at the 40-per-day global ceiling. Pause any time from
  the tab.
- **Safety.** The verify suite runs with the test mailer stub
  (`SIGNL_MAIL_STUB=1`, tests only, never in Netlify): sends never
  touch the network, and addresses containing "stubfail" exercise
  the failure path. Production sends require all three of: armed,
  non-empty queue, inside the window.

## The paid lane, creator reviews of businesses, review links, Managed budget (2026-10-19)

Jeff's model: two lanes, one roster, the business decides. The comp
visit stays the default driver. A **Paid Visit** books a specific
creator at **her own listed rate** for the same Standard Visit
package. Verified in `scripts/verify-paidlane.mjs` (58 checks).

- **Creator fields.** `creator.compOpen` (boolean, default `true`):
  the comp-trade toggle. `creator.paidRate` (USD number or `null`):
  her listed paid rate; `null` means no paid bookings at any price.
  Both are set at registration defaults and edited in the creator's
  own profile settings (`PATCH /api/me/profile`), where the UI
  carries Jeff's verbatim explainer copy for both fields. A rate
  below **$50** is refused with the reason stated (below that,
  processing and support cost more than the booking returns).
  `compOpen: false` means paid-only; the settings copy says plainly
  that paid-only creators receive fewer offers. Discovery cards,
  the full profile view, the founding home, and the public
  `/c/<handle>` profile all show the rate with a "Paid bookings"
  marker and the comp-open state. The discovery `paid=1` filter
  reads `paidRate` (it previously read the Creators-tier
  paid-campaigns comp flag, a different thing; that flag still
  exists for hero cash campaigns).
- **Fee math.** 6% of the rate total, split evenly: business pays
  `rate x 1.03`, creator keeps `rate x 0.97`, platform fee
  `rate x 0.06`. `paidMath()` in lib/router.js is the single source;
  $250 -> $257.50 / $242.50 / $15.00. The subscription is the
  business; 6% is deliberately the lowest take in the industry.
  Comp-only is always fine, forever; paid is an optional
  per-creator upgrade, never a ticket to the roster.
- **Booking plumbing.** `POST /api/bookings/paid` (business, own
  live market, approved non-tester creator with a listed rate)
  creates a normal booking with `kind: "paid"` and a `paidLane`
  object `{ rate, businessTotal, creatorNet, platformFee,
  escrowState, paymentNote, bookedAt, proofAt, releasedAt,
  refundedAt, refundReason }`. Same code, redemption, and
  compliance ladder as a comp visit; the creator's weekly visit
  cap applies; paid bookings do NOT consume the plan's monthly
  visit allowance. Events: `paid_booking_created`,
  `booking_code_issued`.
- **Escrow.** `held` at booking. The compliance sweep releases it
  (`released`, `paid_escrow_released`) when the post proof exists
  AND 48 hours have passed since proof (the hold protects against
  chargebacks on a post that vanishes overnight). It refunds
  (`refunded`, `paid_escrow_refunded`) when the visit resolves as
  a no-show (redemption window expiry in the sweep), when the
  creator is banned under the compliance ladder, or when an honor
  report voids the visit (`business_did_not_honor`). **Pre-Stripe
  honesty:** `paymentNote` reads "Paid visit recorded, no card
  charged. SIGNL holds the payment until the post is live." No
  charge is ever simulated anywhere.
- **Creator reviews of businesses (Momentum correction).**
  `POST /api/bookings/:id/review-business` (creator, own booking,
  status completed, one per booking) stores a `bizreview:{id}`
  record `{ bookingId, creatorId, businessId, businessName, stars,
  text, createdAt }` and logs `creator_reviewed_business`. Leaving
  one earns **+10 Momentum at ANY star rating** (ledger kind
  `review_given`): points pay for honesty, never for praise. The
  old rule (points for RECEIVING a 4-5 star business review,
  `review_high`) is removed from the points table, the ledger, and
  the checklist; reviews a creator receives are profile social
  proof only and mint nothing. External reviews carry no points
  anywhere (Google prohibits incentivized reviews; points there
  would endanger the business's own profile).
- **Business review-page links.** `business.reviewLinks` =
  `{ google, yelp, tripadvisor, facebook }` (optional URLs,
  host-validated per platform by `validateReviewLinks`: a Yelp
  link must point at yelp.com, a Google link at google.com /
  g.page / goo.gl, and so on). Set by the business itself
  (`PATCH /api/me/profile`, Plan tab in the UI) or by an admin
  (`POST /api/admin/review-links`, editor in Admin -> Applications;
  logs `business_review_links_updated`). When present, the
  creator's offer view and completed-visit card show a courtesy
  block ("Their review pages") linking out. Display-if-exists
  only, never mandatory, never on public profiles.
- **Managed talent budget.** `business.monthlyTalentBudget`
  (default 500 at registration and normalized onto legacy records
  at plan selection; editable via `PATCH /api/me/profile`, Plan
  tab). It is a spending cap + authorization the SIGNL coordinator
  spends on paid creator bookings, NOT a held deposit; each
  booking escrows individually. The Managed plan's feature list
  says so. In the Business Preview dashboard, the budget displays
  as a **second simulated business on Managed** ("Harbor Table
  (Managed plan example)") with its own panel: budget set / spent
  this month / remaining, where spent is the sum of that cycle's
  simulated paid bookings' business totals (two bookings over the
  real roster at illustrative rates through the real `paidMath`,
  one escrow released, one held). **Choice made and documented
  here, per the build spec:** Salt & Ember's Growth dashboard is
  unchanged; the Managed view rides alongside it as
  `dashboard.managedView` rather than flipping the simulated
  business's plan. Zero-write invariant holds for the whole
  payload, asserted in both the launch and paid-lane suites.
- **Preview paid booking.** `POST /api/admin/preview/paid-booking`
  (admin) validates the creator and her listed rate, runs the real
  fee math, and returns a flagged simulated booking. No booking,
  no code, no event, no escrow: the paid-lane suite asserts the
  creator's booking count and the event log do not move.
- **Copy rules.** The business-facing line everywhere is some form
  of: "Comp-only is always fine. Pay only when you want a specific
  creator who charges." No em dashes in any of the new UI copy.

## The SIGNL ROAS Score: creator codes and register attribution (2026-10-19)

Jeff's model, built the same day. SIGNL's own return-on-spend
system, labeled everywhere it renders **"SIGNL ROAS Score, our
own model"**. Design rationale and the sales framing live in the
spec (`signl-standard-visit-and-compliance.md`, "The SIGNL ROAS
Score"); this section is the runbook.

- **Constants.** One object in `netlify/functions/lib/router.js`:
  `ROAS_MODEL = { cpm: 22, like: 0.10, comment: 0.50, share: 1.00, defaultDiscountPct: 20 }`
  (SIGNL's published model rates). `GET /api/bootstrap` ships it
  as `roasModel` with the label. Change rates there and only
  there.
- **Creator codes.** Every booking (comp accept and paid) is
  stamped at creation with `creatorCode` (creator handle base,
  uppercase alphanumerics capped at 12, plus a 4-char suffix;
  uniqueness enforced through the `ccode:` index, same retry
  discipline as visit codes), `discountPct` (default 20), and
  `redemptions: null`. The creator's booking view shows the code
  with the share-it framing; the business sees it on the visit
  card. Public `/c/` profiles never carry it (the payload is a
  strict whitelist; the ROAS suite asserts its absence).
- **Cost basis.** `booking.compCostActual` starts at the comp's
  stated value for comp bookings (the dashboard's "comp given at
  the business's own cost" convention) and at the business's
  all-in total for paid bookings. The business corrects it to
  their true cost when reporting a tally. No food-cost percentage
  exists anywhere in code.
- **Reporting.** `POST /api/bookings/:id/code-redemptions`
  (the owning business or an admin; creators get 403, other
  businesses 404). Body: `count` (whole, 0..1,000,000),
  `basketTotal` (0..100,000,000), optional `discountPct` (0..100)
  and `compCostActual` (>= 0). A report REPLACES the stored tally
  `booking.redemptions = { count, basketTotal, discountPct, reportedAt, reportedBy }`
  and logs `code_redemptions_reported`. No POS integration, ever.
- **The math.** One helper, `roasFor(bookings)`, returns
  `{ label, value, registerValue, mediaValue, compCost, discountCost, planAllocation, planKnown, score, allInScore, redemptions, registerBasis, mediaBasis, model }`.
  Per booking: registerValue = basket total; mediaValue = views
  x $22/1000 + likes x $0.10 + comments x $0.50 + shares x $1.00
  from the post's performance report (zero when none);
  discountCost = basket x discountPct/100; planAllocation = plan
  price / visits allowance when the plan is known. Aggregation
  sums values and costs BEFORE dividing; scores are never
  averaged. Zero total cost -> `score: null` (never NaN or
  Infinity). Every booking payload from `withPostState` carries
  its own `roas`. The performance report
  (`POST /api/bookings/:id/performance`) also accepts `comments`
  and `shares` alongside views/likes.
- **Labeling.** Register value is described as tracked spend
  through the code, a floor (code-less customers are not
  counted); media value as modeled at the published rates. The
  strings live in `ROAS_REGISTER_BASIS` / `ROAS_MEDIA_BASIS` in
  the router. No "revenue generated" language anywhere; the
  suites grep for it.
- **Preview.** The Business Preview dashboard's returns story is
  the ROAS block now: the two delivered simulated bookings carry
  fixed tallies (9 redemptions / $486 and 6 / $318) and full
  reported numbers (comments and shares included), so Salt &
  Ember shows Score 6.29x, all-in 5.06x, $804 register, $741.70
  media, $85 comp at cost + $160.80 discounts, over the Growth
  allocation. The old CPM-only media line is gone.
  `POST /api/admin/preview/code-redemptions` recomputes a
  simulated tally in memory and returns the moved scores; it
  writes nothing and logs nothing, and the next dashboard load
  shows the original tallies (asserted).
- **Verification.** `scripts/verify-roas.mjs` (in `npm run
  verify`): the worked example end to end (media 449.40,
  discount 97.20, comp cost 15 -> 8.34, all-in 6.58), codes on
  comp + paid bookings, public-profile absence, endpoint auth
  and validation, replace-not-increment, edge cases, and the
  preview zero-write invariant.

## Environment variables

Set these in Netlify (Site settings, Environment variables) for
production. Locally they go in the shell.

| Variable | Required | Purpose |
| --- | --- | --- |
| ADMIN_PASSWORD | Yes | Password for the admin account (jeff@joinsignl.com, or ADMIN_EMAIL if set). The admin account is created automatically on first request if it does not exist. Pick a strong one; it is never stored in code. |
| ADMIN_EMAIL | No | Defaults to jeff@joinsignl.com. |
| APP_URL | No | Defaults to https://app.joinsignl.com. Used inside QR codes. |
| SIGNL_LOCAL | Local only | Set to 1 for the file-backed local store. Never set in Netlify. |
| SIGNL_LOCAL_DB | Local only | Path of the local JSON database file. |
| SIGNL_TEST_ALLOW_BUSINESS | Tests only | Set to 1 ONLY by the verify suites: re-opens business registration and treats all markets as live so gated flows can be tested. **Never set in Netlify.** Production behavior with it unset: business sign-up closed, markets founding-only until activated. |
| NETLIFY_BLOBS_SITE_ID | Yes (this site) | Netlify site API ID. This site's function runtime does not receive the automatic Blobs context, so the store uses explicit config (added 2026-10-18 after a MissingBlobsEnvironmentError). |
| NETLIFY_BLOBS_TOKEN | Yes (this site) | Netlify personal access token used with the site ID above for Blobs access. |
| SIGNL_SMTP_USER | For email | Mailbox that sends transactional email, hello@joinsignl.com. Without SIGNL_SMTP_USER/PASS, sign-up confirmation and approval emails are queued as events and never sent. |
| SIGNL_SMTP_PASS | For email | A Gmail App Password for that mailbox (requires 2-Step Verification on the account). Never the account's real password. |
| SIGNL_SMTP_HOST / SIGNL_SMTP_PORT | No | Default smtp.gmail.com / 465 (implicit TLS). |
| SIGNL_MAIL_FROM | No | Default "SIGNL <hello@joinsignl.com>". |
| SIGNL_SWEEP_TOKEN | For the scheduled sweeps | Shared secret the Netlify scheduled functions (compliance-sweep.mjs, campaign-sweep.mjs) send as the `x-signl-sweep-token` header to POST /api/admin/compliance/sweep and /api/admin/campaign/sweep. Without it, the compliance sweep still runs via the admin endpoint and the opportunistic in-request trigger; the campaign sweep runs via the admin endpoint only. |
| SIGNL_CAMPAIGN_PACE_MS | No | Delay in milliseconds between sends inside one campaign sweep run (batch pacing). Default 400. |
| SIGNL_MAIL_STUB | Tests only | Set to 1 ONLY by verify-campaign.mjs: sendEmail never touches the network; addresses containing "stubfail" report failure, everything else reports sent. **Never set in Netlify.** |

## Data schema (Netlify Blobs, store "signl-data", one key per record)

- `user:{uuid}` account (name, email, market, city, country, and an
  optional state for unlisted sign-ups; createdAt; status
  lifecycle pending, approved, rejected, with reviewedAt/reviewedBy
  stamps). Creator payload under `creator`: handle, instagramUrl,
  tiktokHandle, tiktokUrl, youtubeChannel, facebookUrl, xHandle,
  xUrl, linkedinUrl, followerCount, avgViews, tierBand,
  suggestedTier, computedTier, categories, compCategories, bio,
  bestWork (up to 3 host-validated Instagram/TikTok/YouTube URLs),
  neighborhood, topAudienceCities, localAudiencePct, localAudienceSource,
  localAudienceAsOf, agreedHonestPosts, agreedFtcDisclosure,
  agreedAt, agreedTerms, termsVersion, marketingEmailConsent,
  marketingConsentAt, openToPaidCampaigns, compOpen (paid lane:
  accepts comp visits, default true), paidRate (paid lane: her
  listed rate in USD, minimum 50, null = no paid bookings),
  hasPhoto, photoUploadedAt,
  igConnected, audienceStack (per-platform counts), totalAudience,
  maxVisitsPerWeek, agreedPostCompliance. The user record also carries termsVersion,
  termsAcceptedAt, marketingEmailConsent, marketingConsentAt, and
  standing ({ state: good/paused/banned, reason, at, bookingId }) once
  the compliance engine has acted. The business payload also carries
  honorReports (running count of didn't-honor reports).
  Founding priority
  is the creator's createdAt order inside their market; nothing extra
  is stored for it. `foundingViewedOn` (date) throttles the
  founding_status_viewed event to once per creator per day. Business
  payload under `business` (businessName, category, plan, planName,
  planPriceMonthly, planMinMonths, billingStatus, planSelectedAt,
  reviewLinks ({ google, yelp, tripadvisor, facebook }, optional
  host-validated public review-page URLs), monthlyTalentBudget
  (Managed plan spending cap for paid creator bookings, default
  500, not a deposit)).
- `email:{email}` uniqueness index to the user id.
- `session:{token}` server-side session (30 day expiry).
- `offer:{uuid}` title, whatComped, dollarCap, visitWindow,
  windowMode (7days/thisweek), spots,
  optional target creatorId, status open/declined.
- `booking:{uuid}` the visit: offer snapshot, visitDate, code,
  codeStatus (issued/burned/expired), status (booked/redeemed/completed/expired),
  checkinAt, redeemedAt, redeemMethod (counter_code/business_confirm),
  postDeadline (redeemedAt + 48h), redeemBy (acceptance + window),
  replacementRequestedAt, compliance ({ reminder1At/2At/3At,
  visitLateAt, missedDeadlineAt, pausedAt, bannedAt, banAt,
  lateDeliveredAt, expiredAt }), honorReportedAt + honorReason,
  staffNotice ({ checkinNoticeAt, redeemNoticeAt }). Paid visits
  add kind ("paid"; absent on comp bookings) and paidLane
  ({ rate, businessTotal, creatorNet, platformFee, escrowState
  (held/released/refunded), paymentNote, bookedAt, proofAt,
  releasedAt, refundedAt, refundReason }). ROAS (2026-10-19) adds
  creatorCode (the per-creator audience code), discountPct
  (default 20), compCostActual (cost basis; starts at the comp's
  stated value, or the paid booking's business total), and
  redemptions ({ count, basketTotal, discountPct, reportedAt,
  reportedBy } or null; written by the business's tally reports).
- `code:{SGNL-XXXXXX}` redemption lookup index to the booking.
- `ccode:{CODE}` creator-code uniqueness index to the booking.
- `post:{uuid}` url, submittedAt, deadline, hoursAfterRedeem, onTime,
  includesDisclosure, verifiedAt/verifiedBy, adUseDeclaredAt/
  adUseDeclaredBy/adUsePlan, performanceRequestedAt, views, likes,
  comments, shares, reportedAt.
- `message:{uuid}` threadId (sorted user-id pair), from/to, body.
- `review:{uuid}` a business's post-visit review of a creator:
  bookingId, creatorId, businessId, businessName snapshot, stars
  (1-5), comment, createdAt. One per completed booking; written only
  via POST /api/bookings/:id/review.
- `bizreview:{uuid}` a creator's post-visit review of a business:
  bookingId, creatorId, businessId, businessName snapshot, stars
  (1-5), text, createdAt. One per completed booking; written only
  via POST /api/bookings/:id/review-business. Feeds Momentum
  (+10 for leaving one, any star rating); never a public rating.
- `favorite:{businessId}:{creatorId}`.
- `photo:{userId}` the creator's profile photo: contentType,
  dataBase64, bytes, uploadedAt. Served without sign-in once the
  creator is approved (it is on their public profile); before
  approval, only to the owner, the admin, or an approved business in
  a live market.
- `config:markets` market activation flags: `{ flags: { [marketName]:
  true } }`. A market with no flag is not live.
- `config:complianceSweep` `{ lastRunAt }`: the throttle claim for
  the opportunistic compliance sweep.
- `config:recruiterKitEmailV1Sent`: one-shot claim flag for the
  recruiter kit email (it can never send twice).
- `campaign:{id}` outreach campaign config: armed, armedAt, armedBy,
  disarmedAt, disarmReason, lastError, lastRunAt, totalSent,
  createdAt. Absent means the campaign exists only as its default:
  disarmed, nothing sent.
- `campaign-recipient:{id}:{email}` one outreach recipient: email,
  name, handle, market, opener, status (queued/sent/bounced/
  skipped), skipReason, sentAt, messageRef, attempts, lastError,
  importedAt, updatedAt. The queue ships empty by design.
- `event:{yyyy-mm-dd}:{uuid}` the append-only event log.

### Event types written today

application_submitted, application_approved, application_rejected,
profile_completed (the full founding profile, including the social
links and comp categories), profile_photo_uploaded,
founding_status_viewed (at most once per creator per day),
market_activated, market_deactivated,
plan_selected, user_signed_in, profile_updated, local_audience_updated,
favorite_added, favorite_removed, offer_created, offer_accepted,
offer_declined, booking_code_issued, creator_checked_in,
visit_confirmed_by_business, code_redeemed, post_submitted,
post_verified, business_review_left, replacement_requested,
message_sent, admin_bootstrapped,
proof_submitted, proof_late_accepted, post_reminder_1,
post_reminder_2, post_reminder_3 (each with its
`*_email_queued` / `*_email_sent` / `*_email_not_sent` delivery
companions), visit_late, visit_deadline_missed, account_paused,
account_unpaused, account_banned, account_reinstated,
offer_expired, staff_notice_sent (plus staff_notice delivery
companions), business_honor_report, ad_use_declared,
post_performance_requested (plus post_performance delivery
companions), post_performance_reported,
campaign_recipients_imported, campaign_armed, campaign_disarmed,
campaign_email_sent, campaign_email_failed, campaign_queue_empty,
campaign_runaway_backstop_reached (bug guard only, never expected
to fire; the campaign data payload carries the campaignId; a send's
payload carries the recipient email, handle, market, and
messageRef), paid_booking_created,
paid_escrow_released, paid_escrow_refunded,
creator_reviewed_business, business_review_links_updated,
code_redemptions_reported.

Each event carries ts, actorId, actorRole, subjectId, market, and a
data payload with the decision-relevant fields (amounts, caps, tier,
plan, timing). Per-market and per-category benchmarks can be computed
from these records plus the booking/post tables.

## Local Impact Score (0-100, stored inputs only)

- 55% local audience share (self-reported until Meta verification).
- 25% reliability from real history: on-time posts count 1, late posts
  0.5, redeemed visits with no post count 0. Creators with no redeemed
  visits yet get a neutral 50 on this component and the profile says
  why.
- 20% engagement: average views as a share of followers, scaled and
  capped. Zero if average views were never provided.
- The score is null ("pending") until a local audience figure exists.
  Components are exposed on the profile so the number is never a black
  box.

## Deploy runbook: app.joinsignl.com

Everything below assumes this directory is the repo root.

1. **Jeff only: create the GitHub repo.** Repo creation cannot be done
   from the agent environment (stored GitHub credentials work for git
   operations but return 401 for repo creation). Create an empty repo
   named `signl-app` under the `bigfatfigtree` account, then this
   codebase can be pushed to it in one step.
2. **Netlify: create the site.** Add new site, Import from GitHub,
   pick the `signl-app` repo. netlify.toml already declares
   publish = public and the functions directory, plus the /api rewrite
   and SPA fallback. No build command is needed; Netlify installs the
   two dependencies from package.json (@netlify/blobs,
   qrcode-generator).
3. **Set the environment variables** from the table above
   (ADMIN_PASSWORD at minimum) on the new site.
4. **Attach the domain.** In the new site: Domain management, add
   app.joinsignl.com. Then add DNS where joinsignl.com's DNS is
   managed: a CNAME record `app` pointing at the new site's
   `<site-name>.netlify.app` hostname. Netlify provisions the TLS
   certificate automatically once DNS resolves.
5. **Netlify Blobs** needs no setup; the "signl-data" store is created
   on first write. Production starts empty on purpose: the staging
   artifact's test accounts (Maya Ellis, Harbor Table) do not migrate.
6. **First sign-in:** visit https://app.joinsignl.com, sign in as
   jeff@joinsignl.com with the ADMIN_PASSWORD from step 3. The admin
   account is created on that first request. Change nothing else; the
   Applications tab is where real sign-ups will land.
7. **Point the marketing site at the app** (separate small change in
   the signl-site repo, not this one): once the domain in step 4 is
   live, the **creator** CTAs on joinsignl.com should link to
   https://app.joinsignl.com (that is where founding profiles are
   built). The **business** CTAs stay on joinsignl.com/businesses.html:
   that page is the founding business list, and it is the whole
   business front door until a market activates. Decide whether the
   current Netlify forms stay as a fallback during the switchover.
8. **Do NOT activate any market yet.** All 39 markets ship
   founding-only. When a market's founding roster is ready (60 to 90
   day window), activate it in Admin, Markets tab; that is also the
   moment to email that market's founding creators at their registered
   addresses and open business onboarding there. Make sure
   SIGNL_TEST_ALLOW_BUSINESS is **not** set anywhere in the Netlify
   environment; it is a test-only flag.

## Known limits, stated plainly

- Business accounts are closed on purpose (launch shape above), not
  broken: the For Businesses page and the API refusal both point to
  the founding business list. Re-opening is two switches: activate the
  market (Admin, Markets) and, when business self-serve is wanted,
  lift the registration gate in lib/router.js (the TEST_MODE flag
  shows exactly where).
- No outbound email yet: applicants are told to sign back in to check
  their status (the UI says exactly that), and approvals are worked
  from the admin Applications tab. Launch emails to founding creators
  go out manually to the registered addresses collected here until a
  mail service is wired in; that is a small follow-up once one is
  chosen.
- Stripe is not connected: plans are recorded, nothing is charged, and
  the UI and stored billingStatus both say so.
- Local audience percentages are self-reported and labeled as such
  until the Meta app review clears and Instagram verification can
  replace them.
- Login throttling is in-memory per function instance (10 attempts per
  10 minutes per email+IP). Good enough for launch; revisit if abuse
  shows up.
- Netlify Blobs reads use strong consistency in this app; the store is
  still a key-value store, so highly concurrent writes to the same
  record are last-write-wins. Fine at launch scale.
