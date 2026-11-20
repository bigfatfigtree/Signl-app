# Magpie privacy labels and data safety, FINAL (for Jeff's review)

Status: FINAL pack, not submitted. Built from the draft audit in privacy-labels.md (code read on 2026-11-20) plus shell facts verified for this pack. Every answer below is traceable to a code fact. Anything that could not be verified from code or from a live check is flagged UNVERIFIED, never guessed.

## Privacy policy URL, verified

https://magpielocal.com/privacy.html returned HTTP 200 on 2026-11-20 (checked directly for this pack). The policy states users must be 18 or older to apply as a creator or a business. The policy text still needs the updates listed at the end of this file before submission, because both stores compare the policy against these labels.

## Shell facts used (verified in mobile/ for this pack)

App ID com.magpielocal.app. The shell is Capacitor in remote URL mode and loads https://app.magpielocal.com (capacitor.config.json). Installed plugins (package.json): push notifications, camera, share, app, splash screen, status bar. iOS Info.plist carries NSCameraUsageDescription and photo library usage strings, and UIBackgroundModes for fetch and remote notification. Android manifest declares INTERNET at the app level.

## Apple privacy labels, filing answers

Data Used to Track You: None, CONDITIONAL. See the tracking flag below.

Data Linked to You, all for App Functionality unless noted:

Contact Info: Name, Email Address, Phone Number.
Financial Info: Payment Info (business cards, handled by Stripe), Other Financial Info (payout setup through Stripe Connect, entered on Stripe hosted pages), Purchase History (bookings and earnings).
Location: Coarse Location (self reported city, state, country, and market on the account; no GPS, no latitude or longitude field exists in the code).
User Content: Photos or Videos (profile and gallery photos and business offer photos; no video file uploads exist), Other User Content (post links, in app messages, applications, reviews).
Identifiers: User ID (account ID and session), Other Identifiers (social handles the creator types on their profile).
Usage Data: Product Interaction (Google Analytics 4 runs on every app view, signed in and signed out, plus a first party event log). Purpose: Analytics and App Functionality.

Data Not Linked to You: none claimed. Do not claim analytics as unlinked, because GA runs in signed in views.

Not collected: precise location, contacts, calendar, microphone, health data, browsing history outside the app, advertising data, sensitive categories (race, health, beliefs, orientation). No crash reporting SDK was found in the code searched.

## Google Play Data Safety, filing answers

Data collected: Personal info (name, email address, phone number, user IDs), Financial info (payment info, purchase history), Location (approximate location only), Photos, App activity (in app actions and searches), Device or other IDs (GA client ID).
Data shared: analytics data to Google, payment processing to Stripe, message delivery to Twilio (SMS) and the email provider (Resend or Postmark), register data flows from Square for businesses that connect it.
Purposes: App functionality, Analytics, Account management. No advertising purpose. No data sold.
Security: data encrypted in transit (HTTPS everywhere). 
Account deletion: an in app account deletion path exists in the code (netlify/functions/lib/router.js, DELETE /me/account, eraseAccount, which erases the profile, sign in, public page, and referral links and emails a confirmation; and public/app.js, Settings to Account screen, deleteAccountHtml and doDeleteAccount). File the deletion URL in Play Console as the app deletion path, and the policy page also carries an email deletion route (hello@magpielocal.com, 30 day completion). Jeff confirms the exact URL to paste during his console session (see jeff-submission-steps.md).

## Camera and scanning, store treatment

The business Counter and staff screens scan a creator QR code in the live web code using getUserMedia plus the BarcodeDetector API (public/app.js, counterScan and staffScan). Frames are read in the moment to decode the code. The draft audit found no code that stores or uploads scan frames. In the native shell the camera also serves profile and visit photos through the Capacitor Camera plugin (bridge takePhoto feeds the existing upload flow). Declare the camera permission on both stores. This does not add a collected data type as long as scan frames are never stored or uploaded.

UNVERIFIED: whether the final built shell records or uploads anything during QR scanning. The web code does not. Whoever builds the submission build must confirm the shipped scanner path matches the web behavior before Jeff files.

## Payments, the exact truthful wording

Businesses keep a card on file through Stripe Checkout. Card numbers go to Stripe; Magpie stores Stripe customer and payment references only, never card numbers. Creators onboard to Stripe Connect Express on Stripe hosted pages and enter bank details, and any identity details Stripe requires, on Stripe's pages. Bank details never touch Magpie's servers. Paid booking money is authorized and held through Stripe and released after the post is live. Declare Payment Info and Financial Info as collected for app functionality on both stores, because Magpie initiates and orchestrates these flows inside its own product. Do not under declare to make the label shorter.

## Push tokens

The bridge (bridge/magpie-native-bridge.js) receives a device push token from the Capacitor PushNotifications plugin and posts it to POST /api/devices/push-token under the signed in session, keeping a copy in localStorage and re sending on foreground.

VERIFIED-ABSENT: the reviewer verified first hand that the endpoint and the bridge adoption are absent in this repo. The evidence is: no "push-token" match in netlify/functions, public/native-bridge.js does not exist, and public/index.html loads only /app.js. Stream A owns the fix. Until it lands, no push token reaches the server and no push can be sent. If tokens are collected by submission time, declare Device IDs / push token under Identifiers (Apple) and Device or other IDs (Google) for App Functionality. If the endpoint still does not exist at submission, the honest filing is that the app requests the permission but the token is stored only on the device. Jeff should not file until this is resolved one way or the other.

## Every UNVERIFIED flag in this file

1. GA tracking caveat: Google Analytics 4 is live in the app (measurement ID in public/app.js, page views and custom events on every view). "No tracking" is truthful under Apple's definition only if the GA property does not have Google Signals or advertising features switched on. That setting lives in Jeff's Google Analytics console and cannot be verified from code. Jeff checks it before ticking No tracking; if Signals is on, turn it off or declare tracking.
2. QR scan frames in the shipped native build: see Camera section above.
3. Push token endpoint and bridge adoption: VERIFIED-ABSENT, see Push tokens section above. Stream A owns the fix.
4. Android merged manifest permissions: the app manifest declares INTERNET only and no installed Capacitor plugin manifest contributes CAMERA or POST_NOTIFICATIONS (both plugins only request permissions the app declares), so the record is: strongly indicated, merged manifest = INTERNET only, pending build confirmation. Verify on the build machine before filing the Play permission declarations.
5. Connected account data (Instagram audience insights, YouTube subscriber counts) is collected only after a creator connects an account, per lib/platform-connect.js. Instagram connect is gated on Meta review in the code. The labels above include this data under Identifiers and Usage; if neither connection is live at submission, the filing is still safe because the labels describe what the app can collect with permission, but Jeff should know the Instagram path may not be exercisable by a reviewer yet.

## Policy text updates required before submission (from the draft audit, all still open)

1. Add phone numbers and SMS notifications through Twilio. The policy does not describe them today; the code sends booking, offer, and deadline SMS as a core rail.
2. Explain Stripe properly: business card on file, paid booking holds, and Stripe Connect payout onboarding where creators give Stripe identity details on Stripe pages.
3. Complete the processor list: Twilio, Resend or Postmark, Stripe, Google (sign in and YouTube), Square. The policy today names only Netlify, Google Analytics, and Meta.
4. Add photos: profile, gallery, and business offer photos are collected and the policy does not mention them.
5. Correct the analytics wording: GA is on for every app view, not "if analytics is enabled." Keep the true line that no advertising trackers run.
6. Extend the connected accounts section beyond Instagram to YouTube and Google sign in. TikTok stays out; no TikTok connection exists in code.
7. Add the Square register connection, including its built in limits (only code touched orders are read, total sales are never stored, disconnect deletes tokens).
8. Add one section on account activity records: bookings, redemptions, posts, messages, reviews, and earnings.
Keep what the policy already gets right: no sale of personal information, the Instagram disconnect and deletion path, and the 18 plus age line.
