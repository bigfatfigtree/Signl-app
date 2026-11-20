# Magpie privacy labels: Apple nutrition labels and Google Play Data Safety

Status: draft filled from a code audit on 2026-11-20, for Jeff's approval. Sources read: `netlify/functions/lib/auth.js`, `lib/router.js` (user record creation and profile fields), `lib/notify.js`, `lib/analytics-ga.js`, `lib/platform-connect.js`, `lib/ig-prefill.js`, `lib/google-auth.js`, `lib/connect.js`, `lib/stripe.js`, `lib/square.js`, `lib/clover.js`, `public/app.js` (file inputs and the analytics loader), and the published policy at `~/workspace/signl-site/privacy.html` (last updated October 15, 2026).

How to read this file: "Collected" uses the stores' meaning, which includes data Magpie's servers store and data sent to its processors (Stripe, Twilio, Resend or Postmark, Meta, Google, Square). Almost everything below is linked to identity, because it sits on a signed in account record. Almost nothing is optional in the store sense once a feature is used; where a field is truly optional it is marked optional.

## The tracking answer, verified

**Tracking (Apple definition): No, with one honest caveat below.**

- No third party advertising SDK, no ad network, no data broker sharing, no Meta Pixel, no Mixpanel, Segment, Amplitude, or PostHog anywhere in the client or server code searched on 2026-11-20.
- **The caveat: Google Analytics 4 is live in the app.** `public/app.js` loads `gtag.js` with measurement ID G-0V1YPFCTSD on every view, signed in or not, and fires page views and custom events through `trackEvent`. `lib/analytics-ga.js` is only the server side read path (it pulls aggregate reports for the admin Stats screen through the GA4 Data API with a service account). So analytics collection is real and must be declared as usage data (below). Under Apple's definition this is not "tracking" as long as the data is not linked across other companies' apps and sites for advertising and is not sold to data brokers, which is true here. But if the GA property has Google Signals or advertising features switched on in the Google console, the honest answer changes. **Jeff must check the GA property settings before anyone ticks "No tracking" in App Store Connect.** If Google Signals is on, either turn it off or declare tracking.
- Google Play Data Safety has no single tracking question; the same GA use must be declared under App activity and Device or other IDs, and the form asks whether data is shared with third parties. Google Analytics counts as sharing for Data Safety purposes in Google's own guidance for many configurations. Declare it as below and let the form's wording at submission time govern.

## Data type by data type

### Contact info

| Data | Collected | Purpose | Linked | Tracking | Evidence |
|---|---|---|---|---|---|
| Name | Yes | App functionality, account management | Yes | No | User record `name` at registration (router.js) |
| Email address | Yes | App functionality, account management, transactional messages | Yes | No | User record `email`; notify.js email leg via Resend or Postmark |
| Phone number | Yes | App functionality, SMS notifications (offers, bookings, post deadlines) | Yes | No | `phoneOf()` in notify.js reads `user.phone`, `creator.phone`, or `business.phone`; SMS via Twilio when configured |
| Physical address | Partial | See note | Yes | No | No home address is collected by Magpie's own forms. Stripe Connect may require a creator's address during Stripe hosted payout onboarding; that data is collected by Stripe on Stripe pages, not by Magpie. Business location is a city and market, plus business details a business types about itself |
| Other contact info | No | n/a | n/a | n/a | Nothing else found |

### Financial info

| Data | Collected | Purpose | Linked | Tracking | Evidence |
|---|---|---|---|---|---|
| Payment info (business cards) | Yes, through Stripe | App functionality, fraud prevention and compliance | Yes | No | `lib/connect.js` and `lib/stripe.js`: businesses keep a card on file with the platform through Stripe Checkout (setup mode). Card numbers go to Stripe; Magpie stores Stripe customer and payment references, never card numbers |
| Payout info (creator bank details) | Through Stripe only | App functionality, compliance | Yes | No | Stripe Connect Express, Stripe hosted onboarding. `lib/connect.js` maps Stripe requirement codes (bank account, ID number, date of birth, address) into plain labels. The underlying values are entered on Stripe pages and held by Stripe |
| Purchase and booking history | Yes | App functionality, account management | Yes | No | Booking, redemption, post, and earnings records in the app store (`booking:`, `post:` records) |
| Credit score or other financial info | No | n/a | n/a | n/a | Nothing found |

Store note: Apple allows "data collected by a third party payment processor" nuances in some cases, but the safe, truthful filing is to declare Payment Info and Financial Info as collected for app functionality, because Magpie initiates and orchestrates the Stripe flows inside its own product. Jeff's call at submission; do not under declare to make the label shorter.

### Location

| Data | Collected | Purpose | Linked | Tracking | Evidence |
|---|---|---|---|---|---|
| Precise location (GPS) | **No** | n/a | n/a | n/a | No `navigator.geolocation` call exists in `public/app.js` and no latitude or longitude field exists on the user record. Searched 2026-11-20 |
| Coarse location | Yes | App functionality, analytics | Yes (account city); No for analytics region | No | The user record carries a self reported `city`, `state`, `country`, and `market`. GA4 also derives approximate region from IP, which the current privacy policy already describes as "approximate region" |

### User content

| Data | Collected | Purpose | Linked | Tracking | Evidence |
|---|---|---|---|---|---|
| Photos | Yes | App functionality | Yes | No | File inputs in `public/app.js` accept PNG, JPEG, or WebP profile photos (claim flow, profile gallery up to 6 photos, business offer photos, all under size limits). Photos are stored server side and served back on profiles and cards |
| Post links and post proof | Yes | App functionality | Yes | No | Creators paste links to their published posts; businesses and creators exchange messages, applications, reviews, and ratings inside the app |
| Customer support and in app messages | Yes | App functionality | Yes | No | In app message threads and platform messages are stored records |
| Videos | Not as uploads | n/a | n/a | n/a | No video file upload input found. Video appears as embedded or linked social posts, not uploads |

### Identifiers

| Data | Collected | Purpose | Linked | Tracking | Evidence |
|---|---|---|---|---|---|
| User ID | Yes | App functionality, account management, security | Yes | No | UUID user IDs, opaque session tokens (30 day sessions in auth.js), staff PIN hashes for register redemption |
| Social handles and account IDs | Yes | App functionality | Yes | No | Creator handles for Instagram, TikTok, Facebook, X, LinkedIn, YouTube, Snapchat and more are profile fields (typed by the creator). Connected accounts (below) add provider account IDs in server only `platconn:` records |
| Device ID | No advertising ID | n/a | n/a | n/a | No IDFA or advertising ID use in a web wrapper context. GA sets its own client ID cookie; declare under Usage data and Device or other IDs on Google Play to be safe |

### Usage data and diagnostics

| Data | Collected | Purpose | Linked | Tracking | Evidence |
|---|---|---|---|---|---|
| Product interaction | Yes | Analytics, app functionality | Can be linked (GA runs signed in too) | See tracking caveat | GA4 page views and events on every app view; first party event log in `lib/events.js` powers product features and admin reporting |
| Advertising data | No | n/a | n/a | n/a | No ads served, no ad measurement |
| Crash data, performance data | No dedicated collection | n/a | n/a | n/a | No crash reporting SDK found in the code searched. The native shell may add one later; if it does, this file must be updated before submission |
| Search history (in app) | Yes | App functionality | Yes | No | Business searches for creators and in app discovery are product actions stored as events |

### Sensitive and other data

| Data | Collected | Purpose | Linked | Tracking | Evidence |
|---|---|---|---|---|---|
| Audience data from connected social accounts | Yes, with permission | App functionality | Yes | No | `lib/platform-connect.js`: Instagram audience city insights and follower counts, and YouTube channel subscriber counts, fetched by OAuth after the creator connects. Tokens live only in server side `platconn:` records, never in client payloads. Instagram connect is built but gated on Meta review; YouTube has a live code path gated on Google credentials in env |
| Public profile prefill data | Yes | App functionality | Yes | No | `lib/ig-prefill.js` reads a public Instagram profile (name, photo, counts) to prefill a claim form. The creator reviews and edits everything before it saves |
| Google sign in identity | Yes, if used | App functionality, account management | Yes | No | `lib/google-auth.js`: only the Google subject ID and verified email are stored. Tokens are used once and discarded |
| Square register data (businesses that connect) | Yes, limited by design | App functionality | Yes | No | `lib/square.js`: only orders touched by Magpie codes are read. Total Square sales are never stored. Loyalty matching stores an HMAC hash, never a customer identity. Disconnect deletes tokens at once |
| Race, health, beliefs, sexual orientation, and similar sensitive categories | No | n/a | n/a | n/a | Not collected. Content categories are about the creator's content (food, fitness, beauty and so on), not sensitive personal attributes |
| Contacts, calendars, microphone, health data | No | n/a | n/a | n/a | No address book, calendar, microphone, or health access anywhere in the code |
| Browsing history outside the app | No | n/a | n/a | n/a | Nothing found |

### Camera note for the native shell

The business Counter screen uses the device camera to scan a creator's QR code through the browser `BarcodeDetector` API (see the counter redeem code in `public/app.js`). In the native shell this becomes a real camera permission. Camera images are used to read the code in the moment; no photo or video is stored from scanning. Declare the camera permission in both stores' permission lists, and in Apple's label this does not add a collected data type as long as frames are never uploaded or stored. **The shell builder must confirm frames are not recorded; if the shell's scanner library uploads anything, this answer changes.**

## Code versus privacy policy disagreements (every one found)

The published policy at magpielocal.com/privacy.html is dated October 15, 2026 and says it "covers this website and our founding applications; platform terms at launch will add detail." The live platform has outgrown it. These must be fixed in the policy before store submission, because both stores check the policy against the labels:

1. **Phone numbers and SMS are missing from the policy.** The policy lists business contact phone in applications, but never says Magpie stores account phone numbers and sends SMS notifications through Twilio. Code: notify.js sends booking, offer, and deadline SMS as a core rail. Policy must add phone and SMS, and name Twilio as a processor.
2. **Stripe is nearly invisible in the policy.** The policy mentions Stripe once, in the UK section ("bank details, which are held by Stripe"). It never explains that businesses put a card on file through Stripe, that paid bookings are authorized and held through Stripe, or that creators onboard to Stripe Connect for payouts and give Stripe identity details (which can include ID number, date of birth, and address) on Stripe's pages. This is the biggest gap for a payments product.
3. **Processors list is incomplete.** The policy names Netlify, Google Analytics, and Meta. The code also uses Twilio (SMS), Resend or Postmark (transactional email), Stripe (payments and payouts), Google (sign in and YouTube), and Square (register data for businesses that connect it). All belong in the policy's processor section.
4. **Photos are not mentioned.** The policy's "what we collect" lists application fields only. The platform collects profile and gallery photos and business offer photos. Add them.
5. **Analytics wording understates the app.** The policy says "if analytics is enabled, aggregate visit statistics." In the app, GA4 is unconditionally enabled and loads on every view including signed in views, with custom events. The policy should say analytics is on, what it collects (pages viewed, approximate region, device type, in app actions), and that it is Google Analytics. The policy's line "We do not run advertising trackers" is still true as written, and should stay, but it sits next to the GA disclosure so a reader is not misled.
6. **Connected accounts section covers Instagram only.** The policy describes the Instagram connection well (audience cities, local statistics, disconnect and deletion). The code also has a YouTube connection (subscriber counts) and Google sign in. Add both. TikTok is correctly absent: no TikTok connection exists in code, counts are typed by the creator.
7. **Square register connection is not in the policy at all.** Businesses can connect Square and Magpie reads code touched orders back. The policy needs a short Square paragraph, including the honest limits already enforced in code (no total sales, no backfill, disconnect deletes tokens).
8. **In app messages, bookings, and earnings records are not described.** The policy reads as an applications policy. A platform policy needs one section covering account activity records: bookings, redemptions, posts, messages, reviews, and earnings.
9. **What the policy gets right, keep:** no sale of personal information (true in code, no sharing for advertising), Instagram disconnect and data deletion path with the hello@magpielocal.com deletion route and 30 day completion, the 18 plus age line, and the UK section's bases and partner visibility limits. No code was found that contradicts the no sale promise.

## Filing summary (the short version to type into the consoles)

- Apple: Data Used to Track You: **None** (conditional on the GA Google Signals check above). Data Linked to You: Contact Info (name, email, phone), Financial Info (payment info through Stripe, purchase history), Location (coarse), User Content (photos, messages, post links), Identifiers (user ID, social handles), Usage Data (product interaction). Data Not Linked to You: none claimed; do not claim the GA data as unlinked, because GA runs in signed in views.
- Google Play Data Safety: declare collection (not just sharing) for Personal info (name, email, phone, user IDs), Financial info (payment info, purchase history), Location (approximate), Photos, App activity, and Device or other IDs (GA client ID). Data shared: analytics data to Google, payment processing to Stripe, messages to Twilio and the email provider, register data flows from Square. Data is encrypted in transit (HTTPS everywhere). Account deletion: the policy's email deletion route exists; Google also expects an in app or web account deletion path for apps with account creation, so **flag for Jeff: confirm the in app account deletion route exists in the shell build, or add the policy page URL as the deletion link in the console.**
- Both stores: purposes are App functionality, Analytics, and Account management. No data is used for advertising. No data is sold.
