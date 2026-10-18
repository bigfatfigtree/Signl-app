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
  tab), default OFF for all 11 markets. Until a market is live, its
  approved creators see only the founding status page, and discovery,
  offers, bookings, the counter, posts, and messages refuse with the
  launch-window message.
- **The creator roster is never public.** No public roster pages
  exist; discovery requires an authenticated, approved business
  account in a live market, and creator photos are served only to the
  owner, the admin, or such a business.

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
  Beauty & Grooming, Fitness & Wellness, Retail & Shopping,
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
- Business discovery: browse approved creators in a market, filter by
  tier and category, search, favorite.
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
node scripts/verify-flow.mjs        # 57 checks: main marketplace flow
node scripts/verify-fallbacks.mjs   # 14 checks: check-in / confirm fallbacks
node scripts/verify-launch.mjs      # 61 checks: the launch shape itself
npm run verify                      # all three, in order
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

All three suites were run green against this codebase on 2026-10-18
(132 checks total).

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

## Data schema (Netlify Blobs, store "signl-data", one key per record)

- `user:{uuid}` account (name, email, market, city, createdAt; status
  lifecycle pending, approved, rejected, with reviewedAt/reviewedBy
  stamps). Creator payload under `creator`: handle, instagramUrl,
  tiktokHandle, tiktokUrl, youtubeChannel, facebookUrl, xHandle,
  xUrl, linkedinUrl, followerCount, avgViews, tierBand,
  suggestedTier, computedTier, categories, compCategories, bio,
  topAudienceCities, localAudiencePct, localAudienceSource,
  localAudienceAsOf, agreedHonestPosts, agreedFtcDisclosure,
  agreedAt, hasPhoto, photoUploadedAt, igConnected. Founding priority
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
- `favorite:{businessId}:{creatorId}`.
- `photo:{userId}` the creator's profile photo: contentType,
  dataBase64, bytes, uploadedAt. Served only to the owner, the admin,
  or an approved business in a live market.
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
post_verified, replacement_requested, message_sent, admin_bootstrapped.

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
8. **Do NOT activate any market yet.** All 11 markets ship
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
