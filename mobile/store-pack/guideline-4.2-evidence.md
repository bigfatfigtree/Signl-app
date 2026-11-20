# Apple Guideline 4.2 evidence: native functionality (for Jeff's review)

Purpose: Apple Guideline 4.2 (minimum functionality) is the standard rejection for a web wrapper. Magpie's shell is Capacitor in remote URL mode: the WebView loads https://app.magpielocal.com (capacitor.config.json, server.url), appId com.magpielocal.app. This file lists the native features a reviewer can exercise, where each lives in the shell and bridge, and exactly how the reviewer exercises it. It also states the honest weak spots, because App Review will find them anyway and the review notes should get ahead of them.

## The native feature list

### 1. Push notifications (APNs on iOS, FCM on Android)

Where it lives: @capacitor/push-notifications 8.0.0 in package.json. capacitor.config.json sets PushNotifications presentationOptions to badge, sound, and alert. iOS Info.plist declares UIBackgroundModes fetch and remote notification. iOS entitlements carry the aps-environment key (development in the repo, flipped to production at archive, see the flip list in jeff-submission-steps.md). The web side is bridge/magpie-native-bridge.js: initPush() requests permission, registers, listens for registration, pushNotificationReceived, and pushNotificationActionPerformed, and routes a tapped notification into the app when the payload carries a path.
How a reviewer exercises it: sign in, allow notifications when asked, and the device registers. A test push with a data.path payload opens the matching screen on tap. This exercise path is only valid once the adoption steps below have landed and been verified in the submitted build.
Honest status, VERIFIED-ABSENT, must be fixed or disclosed before submission: the reviewer verified first hand that there is no "push-token" match in netlify/functions, public/native-bridge.js does not exist, and public/index.html loads only /app.js, so the bridge is not loaded by the web app and the token endpoint POST /api/devices/push-token does not exist yet. Neither Firebase config file (google-services.json, GoogleService-Info.plist) is in the projects. As the code stands today, push cannot complete end to end. The adoption steps are: load the bridge script, then in public/app.js call MagpieNative.initPush() after sign in and define window.magpieNativeRoute(path) to route deep link and push taps. Stream A is implementing them, and the flip list in jeff-submission-steps.md verifies them. The submission build must also land the token endpoint and the Firebase and APNs wiring before anyone claims push in the review notes. Do not submit on the promise; submit on the working build and note the demo path in the review notes.

### 2. Camera QR scan redemption

Where it lives: two layers. The product layer is live web code today: public/app.js counterScan() and staffScan() open the device camera with getUserMedia (environment facing) and decode with the BarcodeDetector API on the business Counter and staff screens; the creator side shows a booking QR image served from /api/bookings/<id>/qr on booking cards and the My Visits surface. The native layer is @capacitor/camera 8.0.0 plus the bridge takePhoto(), which feeds the existing photo upload flow, and iOS usage strings in Info.plist (NSCameraUsageDescription: "Magpie uses the camera so you can take profile and visit photos.").
How a reviewer exercises it: sign in as a business (demo account in the review notes), open the Counter screen, tap "Scan the creator's QR", and scan the creator demo account's visit code. Manual code entry is the fallback on the same screen. Also: edit a profile photo and choose the camera.
Caveat for the review notes: inside the iOS WebView, the web scan path depends on WebKit camera access for the loaded page. If the shipped build's scan path underperforms in the shell, the fallback is manual code entry, which always works, plus the native Camera plugin for photos. Test the scan on a real device in the shell before submission and record the result; this is the single most likely 4.2 demo failure.

### 3. Native share sheet

Where it lives: @capacitor/share 8.0.0 in package.json. Bridge share() calls the native Share plugin with title, text, and url, falls back to navigator.share in a browser, and rejects cleanly when neither exists.
How a reviewer exercises it: open a creator profile or a claim link surface in the app and tap Share; the iOS share sheet or Android chooser opens with the Magpie link.
Status: plugin and bridge verified in code. The web app's share buttons route through MagpieNative.share() only once the bridge adoption batch lands (same batch as push). Until then, sharing inside the shell falls back to the web share path. Flagged so the review notes only claim what the submitted build actually does.

### 4. Deep links: claim links open the app (universal links and app links)

Where it lives: prepared files in mobile/deep-links/. The apple-app-site-association claims paths /claim*, /c/*, /roster/*, /founding-claim, /invite/*, /r/* for app.magpielocal.com. iOS entitlements (ios/App/App/App.entitlements) declare applinks:app.magpielocal.com and webcredentials:app.magpielocal.com. Android: assetlinks.json for package com.magpielocal.app, and AndroidManifest.xml carries autoVerify intent filters for the same host and paths. Bridge initAppEvents() listens for App appUrlOpen events and hands the path to window.magpieNativeRoute(path) when the web app defines it, so a claim link lands on the right screen, not the home page. The web side adoption steps are the same as for push: in public/app.js, call MagpieNative.initPush() after sign in and define window.magpieNativeRoute(path) to route deep link and push taps.
How a reviewer exercises it: with the app installed, tap a claim link (for example a founding claim link from an email or the demo link in the review notes) and the app opens on the claim flow. In Safari or Chrome the same link loads the web claim flow. This exercise path depends on the VERIFIED-ABSENT bridge adoption above: until public/app.js defines window.magpieNativeRoute(path), a tapped link cannot be routed by the bridge inside the app.
Honest status, verified live for this pack on 2026-11-20: the association files are NOT deployed. https://app.magpielocal.com/.well-known/apple-app-site-association and /.well-known/assetlinks.json both return HTTP 200 but with the app's HTML page (the single page app fallback), not the JSON files. Deep links will not verify until the files are served at those exact paths with Jeff's real Team ID and the Play signing SHA-256 fingerprint in them (flip list). This is a submission blocker, not a nice to have: claim links are Magpie's main acquisition path.

### 5. Sign in and account system (supports Guideline 5.2 and general depth)

Where it lives: the live app. Email and password sign in with 30 day sessions (lib/auth.js), plus an emailed one time sign in link that expires in 30 minutes, Google sign in (lib/google-auth.js, stores only the Google subject ID and verified email), forgot password, and an in app account deletion flow (router.js). The sign in screen was captured as a real still in the walkthrough set (see screenshots-FINAL.md, file C).
How a reviewer exercises it: use the demo accounts supplied in the review notes (one creator, one business), sign in, and walk offers, booking, redemption, and wallet. Review notes must include both demo logins and the staff PIN path for the Counter screen, or review will stall at the signed out wall.

### 6. Supporting native pieces

Splash screen and status bar: @capacitor/splash-screen and @capacitor/status-bar, configured in capacitor.config.json (300 ms splash, auto hide, bridge hides it again on page load so signed in users open straight into their dashboard). App state and Android back button events are forwarded by the bridge. Offline fallback: www/index.html is a plain "needs an internet connection" page, which is honest behavior for a marketplace client.

## What to paste into the App Review notes (draft for Jeff to approve)

Magpie is the native app for the Magpie local creator marketplace (businesses book local creators, ranked by local reach). Beyond the web experience, the app adds: push notifications for offers, bookings, and post deadlines (allow notifications after sign in, then trigger one from the demo business account); camera QR scanning for in person visit redemption (business demo account, Counter screen, scan the creator demo visit code; manual entry also works); the native share sheet on profiles and claim links; and universal links, so claim and invite links open the app on the right screen. Demo accounts: creator and business logins plus a staff PIN are listed in the review information. Payments run through Stripe hosted pages (real world services), and creators receive payouts through Stripe Connect.

Do not paste this until items 1, 3, and 4 above are true in the submitted build. As of this file, they are prepared in the shell and bridge but not yet wired end to end.

## Bottom line for 4.2

The shell is a real native app with real native integrations, not a bare WebView: six Capacitor plugins, entitlements, background modes, and a purpose built bridge. The risk is not the architecture; it is submitting before the wiring batch lands. The flip list in jeff-submission-steps.md is the order of work.
