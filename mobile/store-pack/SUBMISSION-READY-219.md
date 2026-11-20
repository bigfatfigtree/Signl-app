# Magpie — SUBMISSION-READY PACK for Build -219 (2026-11-20)

**Status: ready for Jeff's review. NOTHING IS SUBMITTED.** Jeff reviews the
listing copy in full and signs into his own developer accounts himself.
That is the hard stop line, and this pack ends there.

**Repo state (2026-11-20):** the signl-app repo is fully pushed, local
main == origin/main. A clone or pull on Jeff's Mac brings everything:
Build -221 (commits 4e18e32, 60abf8b), the v2 app icon wiring
(c2e04fe), the Firebase configs (49b134f), and this pack.

## What shipped today

- **Build 2026.11.20-219 is LIVE** at app.magpielocal.com (deployed
  2026-11-20, commits 877a686 → 4f75835 on main). It carries:
  - Build -218: the A+E defect batch (Review/Home copy removed from
    Review, Wallet "Paid out" card restored, Discover count reconciled
    and its action dock moved off faces, push-token registration
    endpoint POST /api/me/push/devices + native bridge adoption, Anton
    + first-paint splash).
  - Build -219a: the F2 entry — Jeff's locked v5 intro film
    (intro-film-v5.mp4, served from the web app so it can be swapped
    without resubmission) into the locked borderless F2 sign-in.
  - Build -219b: one unified hamburger menu for all eight shells
    (creator, business local, business national, admin, partner,
    pilot, Biz Dev, recruiter) carrying each role's full destination
    set, built to the reviewed checkpoint v2 spec.
  - Build -219c: soft delete + admin restore. Deletion is no longer a
    one-way door: records are preserved flagged, access dies, the
    account vanishes from every surface, and an admin can restore it
    from Admin → Deleted accounts to its exact prior status.
  - Two rendered-walk fixes: the sign-in background is a clean film
    frame (the final frame's baked-in mock UI ghosted through the
    wash) with the gradient Sign in pill restored over the theme's
    black pill; and the "See how Magpie works" link out of sign-in
    actually reaches the classic home (it was dead).
- **Proof:** verify-build218 44/44, verify-menus219 56/56,
  verify-deletion 91/91 (full delete/restore fixture proof); a
  rendered Playwright walk of the seeded app (entry, sign-in, creator
  + business + admin menus, Find offers, Find creators, Deleted view)
  and a live signed-out walk on production (build stamp, film playing,
  gradient pill, no page errors). Records:
  goals/magpie-store-app-packaging/hidden_files/stage1-ground-truth-2026-11-20.md
  and stage2-3-verification-2026-11-20.md, walk-219/, walk-219-live/.
- **Held out of the deploy on purpose:** the placeholder deep-link
  files (public/.well-known/*). They carry literal NEEDS_JEFFS_TEAM_ID
  / NEEDS_SIGNING_CERT values; serving them would publish invalid
  files the platforms cache. Canonical templates live in
  mobile/deep-links/. They land the day Jeff supplies the real values
  (flip list below). **Update 2026-11-20:** Jeff supplied the Apple
  Team ID (NM583B2RM2); the finished apple-app-site-association is
  deployed and verified live at magpielocal.com/.well-known/
  apple-app-site-association. The Android assetlinks.json stays held
  (see flip item 5).

## Listing copy (in full, for Jeff's review)

App name (both stores): **Magpie**
Apple subtitle: **Local influencer marketing**
Google Play short description: **Local influencer marketing: businesses book nearby creators by local reach.**
Apple promotional text: **Local creators, ranked by local reach. Free for creators.**

Full description (both stores):

Magpie is a local influencer marketing platform. Local businesses book nearby creators, and creators are ranked by local reach: how many of their followers actually live in the business's city, shown before anyone books. Follower count is not the headline. Local reach is.

For businesses:
Browse creators in your market, ranked by the share of their audience that lives near you, with each creator's rate on their card. Book a comped visit (your meal, service, or experience, at your cost) or a paid booking at the creator's own listed rate. Every visit is tracked in the app in three steps: Checked in, Posts live, and Redeemed, so you can see who showed up, what was posted, and who came in from the post. To redeem a visit, the creator shows their code in the app and your staff scan or enter it at the counter.

For creators:
Join free. You never pay to join, to be listed, or to get booked. Set your own rate for paid bookings and keep 97% of it. The 3% on a paid booking is taken from the payout to cover money transaction fees, so payment is immediate. Comped visits carry no fee at all. Paid money is held until your post is live. Your profile shows businesses your local reach first, which is how smaller local followings get booked ahead of larger distant ones.

How a visit works:
A business posts an offer or books you directly. You visit, the business redeems your code, and you post honestly, with the goal of posting within 48 hours of the visit. Honest posts only: no business can require praise.

Founding, city by city:
Magpie is opening market by market. Founding creators and founding businesses join now in their city, and booking opens in each market as its roster is ready. Founding business plan details and prices are on magpielocal.com.

Sign in or apply from the first screen. You must be 18 or older to use Magpie.

Apple keywords: creator,creators,business,comped,visits,bookings,neighborhood,restaurant,UGC,posts,reach,nearby
What's New 1.0: "Magpie 1.0: local influencer marketing, in an app. Businesses: find nearby creators ranked by local reach, book comped or paid visits, and track Checked in, Posts live, and Redeemed. Creators: join free, set your own rate, and keep 97% of paid bookings."
Categories: Apple Business (primary) / Lifestyle (secondary); Play Business.
Marketing URL: https://magpielocal.com · Privacy URL: https://magpielocal.com/privacy.html
Support URL: **OPEN DECISION for Jeff** (see flip list).

Copy notes vs the earlier FINAL draft: the copy itself is unchanged
(it was written against features that all still stand). One rationale
update: push notifications stay OUT of the copy, now because there is
still no send path — token registration landed in Build -218, but no
notification can be sent yet, so the listing promises none.

## Screenshots (screenshots-219/)

Fourteen captures at exact store sizes: Apple 1290×2796 set and Play
1080×1920 set, seven scenes each: intro film frame, sign-in, creator
home, creator Find offers, business home, business Find creators,
admin home. They replace the stale pack (the old single shot was the
pre-design signed-out page; do not use it).

**Provenance, stated plainly:** the signed-out scenes are the live
production app. The signed-in scenes were captured on a seeded local
run of the exact live Build -219 code, because capturing production
signed-in screens requires Jeff's own session, which the crew does not
use. Names and numbers in the signed-in shots are fixture data. Before
actual upload, re-capture the signed-in set inside the native shell
build using the demo accounts (flip list), which is also what App
Review will see.

## Privacy and data safety answers (updated for -219)

Apple App Privacy:
- Data Used to Track You: **None** — conditional on Jeff's Google
  Analytics Signals check (flip list). If Signals or advertising
  features are on, this answer changes.
- Data Linked to You: contact info (name, email, phone, handles);
  financial info (payment handled by Stripe; Magpie never sees card
  numbers); purchase history (plans, bookings, wallet ledger); coarse
  location (self-reported city, state, country, market — the app
  collects no GPS location); photos and videos and other user content
  (profile and visit proof); identifiers (user ID, social handles,
  and **push device token** — NEW in this build: the -218 endpoint
  stores a push token and platform per signed-in device; declare it);
  product interaction (Google Analytics 4, for Analytics and App
  Functionality).
Google Play Data Safety mirrors the above: data shared with processors
(Twilio for SMS, Resend/Postmark for email, Square for register
flows), no data sold, everything encrypted in transit (HTTPS), account
deletion available in app (self-serve) — and since -219c, deletion is
a soft delete an admin can reverse; the public privacy policy wording
on retention is one of the text updates below.
Full detail: privacy-FINAL.md (its eight website policy-text updates
are still required before submission; Jeff approves wording).

## Guideline 4.2 evidence (why this is not "a website in a frame")

Six real native pieces via Capacitor, all in the shell build: push
registration, camera (QR scan at the Counter, with manual entry
fallback), native share sheet, app lifecycle, splash screen, status
bar; plus the JS bridge that activates them only inside the shell and
is a no-op in a browser. The entry film and all product UI are served
from the web app, so web updates reach the app without resubmission;
only shell changes need a new binary. App Review notes must not claim
end-to-end push (registration only, no send path) and must not claim
deep links until the association files are live (flip list). Demo
accounts are required or review stalls. Full evidence:
guideline-4.2-evidence.md.

## The flip list (what only Jeff can do, in order)

1. **Review this listing copy** and say go. (The stop line.)
2. **Support URL decision:** add a short support page to
   magpielocal.com, or file with the FAQ page
   (magpielocal.com/creator-faq.html, which resolves today). Both
   stores require a support URL.
3. **Approve the privacy policy text updates** (eight items in
   privacy-FINAL.md) so they can go live on magpielocal.com/
   privacy.html before submission.
4. **Apple Team ID — DONE 2026-11-20.** Jeff supplied the Team ID
   **NM583B2RM2** on 2026-11-20. Both placeholders in
   mobile/deep-links/apple-app-site-association are filled (app ID
   NM583B2RM2.com.magpielocal.app, applinks + webcredentials), and
   the finished file is deployed and verified live at
   https://magpielocal.com/.well-known/apple-app-site-association
   (valid JSON, no redirect, served via the signl-site repo).
5. **Google Play signing SHA-256** (Play Console → App integrity,
   after Play App Signing is on) → same treatment for assetlinks.json.
   **STILL OPEN as of 2026-11-20:** Play App Signing is not enabled
   yet, so the NEEDS_SIGNING_CERT_SHA256_FINGERPRINT placeholder
   remains in mobile/deep-links/assetlinks.json and the file is NOT
   deployed. It lands only after Jeff enables Play App Signing and
   supplies the app signing key's SHA-256 fingerprint.
6. **aps-environment → production** at archive time (currently
   "development" in the iOS entitlements; Xcode/App Store Connect
   step under Jeff's team).
7. **Firebase project — DONE 2026-11-20.** Jeff created the project
   ("magpielocal") and delivered both config files on 2026-11-20; they
   are placed and pushed (commit 49b134f): GoogleService-Info.plist at
   mobile/ios/App/App/GoogleService-Info.plist and google-services.json
   at mobile/android/app/google-services.json (the Android build.gradle
   already applies the google-services plugin when that file exists).
   Both files are named in mobile/.gitignore, so they were force-added
   to the repo on purpose; a fresh clone has them. One note for the
   Mac build: the Xcode project (App.xcodeproj/project.pbxproj) does
   not yet reference GoogleService-Info.plist — the file sits in the
   App source folder, and if Xcode does not pick it up automatically
   it needs adding to the App target before archiving so it lands in
   the app bundle. Push still cannot SEND until the APNs key (item 8)
   and a send path exist; the listing does not promise push.
8. **APNs key (.p8)** from Jeff's Apple account, same purpose.
9. **Android upload keystore**: create it on the build machine and
   wire signingConfig (build.gradle has none today); Jeff holds the
   keystore and its password.
10. **Icon master v2 approval**: mobile/assets/icon-master-1024-v2.png
    exists; the v1 master has a visible corner tonal step. Jeff picks.
11. **iPad decision:** file iPad screenshots (2064×2752) or restrict
    the build to iPhone.
12. **GA Signals check: DONE 2026-11-20.** Jeff checked the Magpie
    GA4 property (G-0V1YPFCTSD, the property still named for
    joinsignl.com) and Google Signals is OFF; no change was needed.
    The Apple answer stands: "Data Used to Track You: None."
13. **Demo accounts for App Review:** one creator login, one business
    login, one staff PIN, created in the live app before submitting.
14. **Build the binaries on Jeff's Mac** (blocker + workaround below)
    and upload: Xcode archive for Apple; Android Studio release AAB
    for Play. Console walk-throughs: jeff-submission-steps.md.

## Blocker, named with its workaround

Native binaries cannot be produced on the agent VM: it has no Java
runtime or Android SDK at all (verified 2026-11-20) and no macOS/Xcode
for iOS. Workaround, already the plan in jeff-submission-steps.md:
both binaries are built on Jeff's Mac at submission time. Everything
that does not need a compiler — the live web build, the listing, the
screenshots, the privacy answers, the evidence pack — is done.

## Observations Jeff should know

- **Google sign-in is not configured in production.** The button is
  gated on a Google client ID the server does not currently have, so
  it does not render on the live sign-in (verified in the live walk).
  Pre-existing config state, not a -219 change. If Jeff wants Google
  sign-in, setting the client ID env var turns it on with no build.
- The signed-in live walk in Jeff's own session (partner, pilot,
  recruiter and Biz Dev menus on real data, the Deleted view on live
  data, and the -218 slow-load timing proof on Biz Dev and Admin
  Stats) is still owed and belongs to the parent agent's browser
  route; the menus are proven at data level and on the seeded run.
- Two post-deploy data actions remain, both needing Jeff's session or
  word: run POST /api/admin/repairs/handles once (repairs any
  remaining garbled-name records), and decide the one creator record
  whose city reads "Spanish" (a record edit is Jeff's call).

## Demo accounts for App Review (prepared 2026-11-20, NOT yet created)

Prepared by the submission-prep pass, 2026-11-20 ~13:40 ET. The
identities and signup payloads below are final. The accounts are NOT
created yet, for one reason: a new account's password is set by Jeff
himself on the Secure Vault capture page, never picked or stored by
the agent. Finishing sequence: Jeff sets one password per demo email
on the capture cards, a browser pass submits each signup exactly once
through the live forms using those saved credentials, both sign-ins
are verified, and Jeff approves the creator demo in Review (creator
approvals are his alone; it stays pending until he taps).

1. **Creator demo**
   - Email: app-review-creator@magpielocal.com
   - Password: set by Jeff via Secure Vault (recorded in the vault as
     the saved login for app.magpielocal.com under this email; paste
     from there into both consoles' review notes).
   - Signup: the live claim flow (POST /api/auth/register) with
     role "creator", quickClaim true, primaryPlatform "instagram",
     handle "magpiereviewcreator", followerCount 12400,
     localAudiencePct 65, categories ["Food & Drink", "Lifestyle",
     "Attractions & Events"], market "Nashville", agreedTerms true.
   - Lands PENDING in Jeff's Review queue. Do not approve it for him.
     After his approval it is a complete, bookable-shaped Nashville
     creator profile, which is what App Review needs to see.
2. **Business demo**
   - Email: app-review-business@magpielocal.com
   - Password: set by Jeff via Secure Vault (same handling as above).
   - Signup: the live business form (POST /api/auth/register) with
     role "business", name "Magpie Review Demo Café", market
     "Nashville".
   - Lands in founding state and can sign in immediately; no approval
     is needed to sign in. Full activation stays an admin action,
     same as every founding business.
3. **Staff PIN** for the Counter screen review note: still open, set
   when the demo pass runs.

Endpoint facts verified live 2026-11-20: POST /api/auth/register is
live and validating (an empty probe returns "role must be creator or
business" and creates nothing); passwords must be at least 10
characters; a duplicate email returns 409, so each demo signup is
submitted exactly once.
