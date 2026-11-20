# Magpie store screenshots, FINAL plan (for Jeff's review)

Status: FINAL plan, nothing uploaded. VISUALS GATE still applies: every image is proposed until Jeff approves the exact file. Final submission captures must come from the native shell build, not the web app. Web captures below prove content and layout and are the approved content set to re capture in the shell.

## What each store requires

Apple App Store: up to 10 screenshots per device size. One size set is enough to file if it is the largest: upload the 6.9 inch or 6.7 inch iPhone set (1290 by 2796) and App Store Connect scales it down for smaller displays. iPad screenshots are only required if the app is filed as iPad supported; Magpie's shell supports iPad orientations in Info.plist, so either file an iPad set (2064 by 2752 or 2048 by 2732) or restrict the build. Jeff decides at submission; the step list flags it.
Google Play: minimum 2, up to 8 phone screenshots, each side between 320 and 3840 pixels, aspect ratio no taller than 2 to 1. A feature graphic (1024 by 500) is also required by Play and is a design task, not a capture. GAP: no feature graphic exists yet.

## The exact set, in upload order (8 shots)

1. Signed out entry (the first screen): what Magpie is, both doors, free for creators. EXISTS, see inventory.
2. Sign in screen: email and password, plus the emailed sign in link option. EXISTS, see inventory.
3. Creator apply, claim step 1 and step 2 (handle, market, email). GAP: needs a signed out tap through capture. Was planned in the draft; the capture session's browser failed before the tap through finished.
4. Business join start (the For Businesses door). GAP: same tap through capture session as shot 3.
5. Creator home and offers list, signed in as the preview creator. GAP: needs the signed in filming stream (parallel workstream).
6. Business find creators, cards ranked by local reach, signed in as the preview business. GAP: parallel stream.
7. Visit proof and redemption pair: creator visit QR code (My Visits) and the business Counter scan screen. The features exist in live code today (booking QR images at /api/bookings/<id>/qr and the camera scan path on the Counter screen). GAP: capture only, parallel stream, needs a booked visit on preview data.
8. Wallet and money view (creator earnings and payout state). GAP: parallel stream.

Plus, when it ships: the new intro sign in screen (full screen intro video, then Sign in and Apply fading in) replaces shot 1 as the lead image. GAP: that design was not live on 2026-11-20 and is being filmed in the parallel stream. The current signed out home is the fallback lead shot until then.

## Existing files, audited one by one (each opened and read for this pack)

A. store-pack/screenshots/01-signed-out-home.png, 1170 by 2532.
Real surface: the live signed out home. Shows the Magpie logo, "Local creators. Real regulars.", the plain explanation (businesses comp a meal or a service, creator posts honestly, 48 hour goal, every visit tracked), "Magpie is free for creators. Always.", the Become a Founding Creator and For Businesses actions, the staff redeem line, and the founding sign ups line.
Apple: content qualifies as shot 1. Pixel size is the iPhone 6.1 inch class. App Store Connect accepts 1170 by 2532 in the 6.5 inch display slot in current practice, but the safe filing is to re capture at 1290 by 2796 in the shell. Treat this file as content approved, size to be redone at shell capture.
Google: does not qualify as is. Aspect ratio is 2.16 to 1, over Play's 2 to 1 cap. Crop or pad to 1170 by 2340, or re capture at the Play ratio in the shell pass.

B. xmedium-qa/app-walkthrough-2026-11-20/stills/01-signed-out-entry.png, 780 by 1688.
Same signed out entry surface as file A, captured by the walkthrough stream.
Apple: does not qualify, resolution too small.
Google: does not qualify as is, same 2.16 to 1 aspect problem, and 780 wide is low resolution next to the store pack capture. Use file A as the source for shot 1, not this one.

C. xmedium-qa/app-walkthrough-2026-11-20/stills/02-sign-in-screen.png, 780 by 1688.
Real surface: the live sign in screen. Shows email and password fields, the Sign in button, the 30 day session note, Forgot password, the emailed sign in link option with its own email field, and the founding creator and founding business join links at the bottom.
Apple: content qualifies as shot 2, resolution does not. Re capture at 1290 by 2796 in the shell.
Google: content qualifies as shot 2 after a ratio crop; re capture in the shell pass at full resolution instead.

## Gap list (nothing here is faked or mocked)

1. Shots 3 and 4 (claim steps, business join start): signed out tap through captures, no account needed. Quick re run once a browser session is available.
2. Shots 5, 6, 7, 8 (all signed in surfaces): being filmed in the parallel stream with the app's own preview creator and preview business accounts. No real creator or business data may appear in any shot.
3. Intro video entry screen: parallel design and filming stream. Replaces shot 1 when live.
4. Google Play feature graphic, 1024 by 500: does not exist. Design task, needs Jeff's visual approval like every other visual.
5. iPad set: only needed if the build is filed with iPad support. Decide with the build, see jeff-submission-steps.md.
6. App preview video (Apple, optional) and Play promo video (optional): not required for approval. Skip for v1.0 unless Jeff wants them.

## Rules kept from the draft

Only real app surfaces, captured from the real app. No composited marketing screens with invented UI. Any caption text added on top of a capture is a design decision for Jeff to approve, and the base capture must still be the real screen.
