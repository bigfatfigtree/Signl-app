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
  joining locks in founding pricing ($299/mo Self-Service, $799/mo
  Managed, 3-month minimum). Business accounts open per market at
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
  15k+) is auto-suggested from the follower count and confirmed by the
  creator. Social inputs are normalized to canonical URLs (a bare
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
  bypass the human review. DM copy is unchanged: DMs still carry the
  generic link.
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
- Business plans: Self-Service $299/mo and Managed $799/mo, 3-month
  minimum. Plan selection is recorded at registration and can be
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
node scripts/verify-flow.mjs        # 97 checks: main marketplace flow
node scripts/verify-fallbacks.mjs   # 14 checks: check-in / confirm fallbacks
node scripts/verify-launch.mjs      # 164 checks: the launch shape itself
npm run verify                      # all three, in order (275 total)
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

All three suites were run green against this codebase on 2026-10-19
(275 checks total, including the Momentum points math end to end:
a recruiter with 2 credited sign-ups and 1 approval sits at 16
points in their own payload, the admin applications payload, and
the recruiter leaderboard; the Business Preview isolation checks and
the business review round-trip described below are covered too).

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
Self-Service / $799 Managed, pick a plan and a market), (2) Discover
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
  marketingConsentAt, openToPaidCampaigns, hasPhoto, photoUploadedAt,
  igConnected. The user record also carries termsVersion,
  termsAcceptedAt, marketingEmailConsent, marketingConsentAt.
  Founding priority
  is the creator's createdAt order inside their market; nothing extra
  is stored for it. `foundingViewedOn` (date) throttles the
  founding_status_viewed event to once per creator per day. Business
  payload under `business` (businessName, category, plan, planName,
  planPriceMonthly, planMinMonths, billingStatus, planSelectedAt).
- `email:{email}` uniqueness index to the user id.
- `session:{token}` server-side session (30 day expiry).
- `offer:{uuid}` title, whatComped, dollarCap, visitWindow, spots,
  optional target creatorId, status open/declined.
- `booking:{uuid}` the visit: offer snapshot, visitDate, code,
  codeStatus (issued/burned), status (booked/redeemed/completed),
  checkinAt, redeemedAt, redeemMethod (counter_code/business_confirm),
  postDeadline (redeemedAt + 48h), replacementRequestedAt.
- `code:{SGNL-XXXXXX}` redemption lookup index to the booking.
- `post:{uuid}` url, submittedAt, deadline, hoursAfterRedeem, onTime,
  includesDisclosure, verifiedAt/verifiedBy.
- `message:{uuid}` threadId (sorted user-id pair), from/to, body.
- `review:{uuid}` a business's post-visit review of a creator:
  bookingId, creatorId, businessId, businessName snapshot, stars
  (1-5), comment, createdAt. One per completed booking; written only
  via POST /api/bookings/:id/review.
- `favorite:{businessId}:{creatorId}`.
- `photo:{userId}` the creator's profile photo: contentType,
  dataBase64, bytes, uploadedAt. Served without sign-in once the
  creator is approved (it is on their public profile); before
  approval, only to the owner, the admin, or an approved business in
  a live market.
- `config:markets` market activation flags: `{ flags: { [marketName]:
  true } }`. A market with no flag is not live.
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
message_sent, admin_bootstrapped.

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
