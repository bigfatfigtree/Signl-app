# Jeff's submission steps: Magpie v1.0 (App Store and Google Play)

Nothing here submits anything. This is the exact walk Jeff performs, with his own accounts, when he says go. Developer entity: Extra Medium LLC. App: Magpie, appId and bundle ID com.magpielocal.app, version 1.0.0 (mobile/package.json). Stop line: Jeff reviews the full listing copy (listing-copy-FINAL.md) before any of this starts.

## Before you touch either console (the flip list)

Every placeholder that changes at submission, where the real value comes from, and who supplies it.

1. Apple Team ID. DONE 2026-11-20: Jeff supplied the Team ID NM583B2RM2; both NEEDS_JEFFS_TEAM_ID placeholders in mobile/deep-links/apple-app-site-association (applinks and webcredentials) are filled, app ID NM583B2RM2.com.magpielocal.app, and the finished file is deployed and verified live at https://magpielocal.com/.well-known/apple-app-site-association. The Team ID also selects the signing team in Xcode.
2. Android SHA-256 fingerprint. Placeholder: NEEDS_SIGNING_CERT_SHA256_FINGERPRINT in mobile/deep-links/assetlinks.json. Real value: the SHA-256 certificate fingerprint of the app signing key (not the upload key) from Play Console, App integrity section, once Play App Signing is on. Supplier: Jeff's Play Console. Until both files carry real values and are deployed (item 3), claim links will not open the app.
3. Deep link files deployment. The two files above must be served at https://app.magpielocal.com/.well-known/apple-app-site-association (content type application/json, no redirect) and https://app.magpielocal.com/.well-known/assetlinks.json. Verified 2026-11-20: both URLs currently return the app's HTML page, so the files are not live. Supplier: the build (Brenda), after Jeff supplies items 1 and 2. Verify after deploy by opening both URLs and seeing JSON, not the app page.
4. aps-environment, development to production. Location: ios/App/App/App.entitlements. The archive build under Jeff's team must carry production, or production pushes will not deliver. Supplier: the build at archive time in Xcode. Check the archived entitlements before uploading.
5. Push wiring. Three pieces: (a) the token endpoint POST /api/devices/push-token, which the app batch was to fix; as of 2026-11-20 it is not in netlify/functions and the bridge script is not loaded by the web app, so confirm the batch landed before building; (b) Firebase project files: google-services.json into android/app/ and GoogleService-Info.plist into ios/App/App/, both absent today; supplier: Jeff creates the free Firebase project, the build places the files; (c) APNs key (.p8) plus Key ID from Jeff's Apple Developer account, uploaded to Firebase or to the push sender the backend uses. Supplier: Jeff, from his Apple account.
6. Icon master v2. Current master: mobile/assets/icon-only.png, 1024 by 1024, RGB, no alpha (iOS safe), built by upscaling the real 512 icon. If Jeff approves a crisper v2 master, it drops over that file, then re run the assets generate script in mobile/package.json and cap sync. Supplier: design, with Jeff's visual approval. Nothing visual is final until Jeff approves it.
7. Support URL. No support page exists (support.html and contact.html return 404). Either add a short support page to magpielocal.com (recommended) or file with https://magpielocal.com/creator-faq.html, which resolves today. Supplier: Jeff decides, the build adds the page if chosen.
8. Privacy policy updates. The eight text updates in privacy-FINAL.md must be live on https://magpielocal.com/privacy.html before submission, because both stores compare the policy to the labels. Supplier: the build, Jeff approves the wording.
9. Google Analytics tracking check. In Jeff's GA console, confirm Google Signals and advertising features are off for the Magpie property, or the Apple tracking answer changes. Supplier: Jeff, two minutes in the console. See privacy-FINAL.md.
10. iPad decision. The iOS build currently supports iPad orientations. Either file iPad screenshots too, or restrict the build to iPhone before archiving. Supplier: Jeff decides, the build sets it.
11. Android upload keystore and signing config. Source: mobile/android/app/build.gradle currently has no signingConfigs block, and the upload keystore is Jeff supplied (per mobile/README.md, Needed from Jeff, item 2). This flip item covers all three parts before any signed AAB is produced: Jeff creates or locates the upload keystore, its credentials are stored, and a signingConfig is wired into mobile/android/app/build.gradle and used by the release build. Supplier: Jeff supplies the keystore, the build wires the signingConfig. Verify by confirming the signingConfigs block exists in build.gradle and the release build signs with it.
12. Web app bridge adoption specifics. Source: mobile/README.md, web side change 1. Beyond loading the bridge script (public/native-bridge.js, see flip item 5), public/app.js must do both of these: call MagpieNative.initPush() after sign in, and define window.magpieNativeRoute(path) to route deep link and push taps to the right screen. Stream A is implementing both; this flip list verifies both. Verify by confirming the initPush() call after sign in and the magpieNativeRoute definition are present in public/app.js in the submitted build.

## App Store Connect, step by step (Jeff signs in)

1. Sign in at appstoreconnect.apple.com with the Apple ID on the Extra Medium LLC developer account. Confirm the team is Extra Medium LLC.
2. My Apps, plus button, New App. Platform iOS. Name: Magpie. Primary language: English (US). Bundle ID: com.magpielocal.app. SKU: magpie-ios-1. Create.
3. App Information: subtitle "Local influencer marketing" (from listing-copy-FINAL.md). Primary category Business, secondary Lifestyle. Paste the privacy policy URL: https://magpielocal.com/privacy.html. Content rights: no third party content boxes to tick beyond the standard declaration.
4. Pricing and Availability: price Free (the app is free; business plans are sold on the web, not as in app purchases, because bookings are real world services paid through Stripe). Availability: United States to start.
5. App Privacy: answer from privacy-FINAL.md exactly. Data Used to Track You: None (only after flip item 9). Data Linked to You: the listed types. Publish the labels.
6. Age rating questionnaire: answer from the table below.
7. Prepare for Submission: upload the screenshots (screenshots-FINAL.md set, 1290 by 2796 iPhone set first), paste the full description, keywords, promotional text, support URL (flip item 7), and marketing URL https://magpielocal.com. Copyright: Extra Medium LLC.
8. Build: on a Mac, open the iOS project in Xcode signed into Jeff's team, confirm aps-environment is production in the archive, Archive, and upload. Back in App Store Connect, attach the build. iOS builds cannot be produced on the Linux VM; this step needs a Mac with Xcode.
9. App Review information: paste the review notes draft from guideline-4.2-evidence.md (only once its wiring conditions are true), and add the demo accounts: one creator login, one business login, and the staff PIN for the Counter screen. Create these demo accounts before this step; review stalls without them.
10. Export compliance: the app uses standard HTTPS encryption only; answer the standard exemption. Then Submit for Review. Apple review is Jeff's tap.

## Google Play Console, step by step (Jeff signs in)

1. Sign in at play.google.com/console with the Extra Medium LLC developer account.
2. Create app. Name: Magpie. Default language English (US). App (not game). Free. Accept the declarations.
3. Turn on Play App Signing, then read the app signing key SHA-256 fingerprint from App integrity and hand it to the build for flip item 2.
4. Store listing: short description and full description from listing-copy-FINAL.md. Category Business. Upload the icon (512 by 512 from mobile/icons/icon-512.webp converted to PNG, or the v2 master), the feature graphic (1024 by 500, still a gap, see screenshots-FINAL.md), and the phone screenshots (ratio cropped set).
5. Data safety: answer from privacy-FINAL.md exactly, including the account deletion URL (the in app deletion path exists in code; paste the deletion page URL the console asks for, and the policy page carries the email route).
6. Content rating questionnaire: answer from the table below. Expected outcome is a mature leaning rating because the service is 18 plus with user generated content and in app communication; accept whatever the questionnaire computes, do not game it.
7. Target audience: 18 and over only. This matches the terms and the privacy policy (18 or older to apply as a creator or a business).
8. Permissions declarations: camera (QR scanning and photos) and notifications. If the build prompts for a permissions policy form, the justifications are in guideline-4.2-evidence.md.
9. Build: produce the signed AAB from the Android project (release build with the upload key, after flip item 11 is closed so the signingConfig is wired into build.gradle), upload it to the production track (or internal testing first, recommended, then promote). Confirm the merged manifest permissions on the real build before release (privacy-FINAL.md flag 4).
10. Review and roll out. Submission is Jeff's tap.

## Age rating questionnaire answers, both stores (truthful)

Violence (cartoon, realistic, or prolonged): None.
Sexual content or nudity: None as a feature. User generated photos and posts exist and are moderated through the platform's review and reporting flows; answer the user generated content questions Yes where asked, never None.
Profanity or crude humor: None as a feature; possible inside user generated content.
Alcohol, tobacco, or drug references: None as a feature. Businesses can include restaurants and bars, so if a question asks whether the app references alcohol in user or business content, answer honestly at the lowest frequency the form offers rather than None if the form distinguishes content the app itself provides from content users provide.
Gambling: No simulated gambling, no real money gambling, no contests with cash prizes, no loot boxes. Paid bookings are payment for real world visits and posts, not gambling.
Horror or fear themes: None.
Medical or treatment information: None.
Unrestricted web access: No. The app loads Magpie's own service. Answer No on Apple; on Google, the app is not a general purpose browser.
User generated content, messaging, and sharing: Yes. Creators publish profiles, photos, and post links; businesses and creators message inside the app; profiles can be shared. Moderation: account review before creators are approved, in app reporting, and platform messages from the admin team.
In app purchases (Apple) and in app billing (Google): None inside the app. Business plans are purchased on the web, and booking payments run through Stripe hosted pages for real world services. If either console challenges this, the basis is Apple's rule for services consumed outside the app and Google's equivalent for physical and real world services.
Age floor: the service requires users to be 18 or older (privacy policy and terms). Expect Apple to return 17 plus or 18 plus and Google to return a Mature or Adults Only style rating from these answers plus the 18 plus target audience. Accept the computed rating.

## Order of operations on submission day

1. Flip list items 1 to 9 closed and verified (deep link URLs return JSON, privacy policy updated, GA checked, support URL live, push working on a real device in the shell build, icon approved).
2. Demo accounts created and tested (creator, business, staff PIN).
3. Screenshots captured from the shell build at final sizes and approved by Jeff.
4. Consoles filled from the FINAL pack files, builds uploaded, review notes pasted.
5. Jeff taps submit in both consoles.
