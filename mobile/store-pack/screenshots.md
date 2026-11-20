# Magpie store screenshots: plan and captures

**VISUALS GATE (Jeff, 2026-11-20, binding): every screenshot in this file is PROPOSED, pending Jeff's review. Nothing is final until Jeff approves the exact image.**

## Re-capture items, named first

1. **REQUIRED, NOT YET EXISTING: the new intro sign in screen.** A separate design stream is building a new signed out entry experience (full screen intro video, then Sign in and Apply controls fade in over the video). That design was not live on app.magpielocal.com on 2026-11-20, so it could not be captured. The moment it ships, capture it at the same sizes below as screenshot 1, replacing or preceding the current signed out home. The current signed out home capture (shot 1 below) is the fallback and comparison until then.
2. **Claim flow start, re-capture needed.** The `/claim` address renders the signed out home in the single page app, and the actual claim step 1 only opens after tapping "Become a Founding Creator." The capture session's browser stopped launching before the tap through could be completed (see capture notes). Re-run: open the app signed out, tap Become a Founding Creator, capture step 1 (welcome) and step 2 (handle, market, email).
3. **All signed in shots (shots 4 to 8 in the plan) still need a test account session.** See the account table. No real creator or business data was used or faked.

## Capture method and store sizes

- Captured against the live web app, https://app.magpielocal.com, with the Playwright setup on this VM (full Chromium, `channel="chromium"`, browsers in `~/.cache/ms-playwright`, through the local relay), at 390 by 844 CSS pixels with device scale factor 3, which produces **1170 by 2532 pixel** PNGs.
- 1170 by 2532 is an accepted Apple App Store iPhone size (6.5 inch class accepts 1242 by 2688 or 1284 by 2778 in current App Store Connect, and 1170 by 2532 files from a real device class have been accepted; if App Store Connect rejects the exact pixel size at upload, re-capture at 1290 by 2796 CSS equivalent, 430 by 932 at scale factor 3). For Google Play, phone screenshots must be between 320 and 3840 pixels per side with a max aspect ratio of 2:1; 1170 by 2532 has an aspect ratio slightly over 2:1 (2.16:1), so **for Google Play, crop or pad to 1170 by 2340 or re-capture at 390 by 780.** Flagged so nobody uploads the Apple file to Play unchanged and gets a rejection.
- Final store screenshots should be captured from the native shell, not the web app, once the shell exists. Web captures here prove content and layout; shell captures are the submission files.

## Captured shots (each one opened and read before listing)

### Shot 1: Signed out home (current entry experience, fallback for the new intro screen)

- File: `screenshots/01-signed-out-home.png` (1170 by 2532)
- State: signed out, live app, 2026-11-20
- Status: **proposed, pending Jeff's review**
- What it shows, verified by reading the image: the Magpie logo and Sign in at the top; the headline "Local creators. Real regulars."; the plain explanation that local businesses comp a meal or a service and a local creator posts honestly with a 48 hour goal; "Magpie is free for creators. Always."; the Become a Founding Creator and For Businesses actions; the staff redeem line; and the founding line about sign ups open in all 48 markets with decisions within 2 business days.
- What it proves: the first screen explains the product in plain words to a stranger, names both audiences, and states free for creators. It is a real screen, not an error or a blank page.
- Note: a duplicate capture taken at the `/claim` address was byte identical to this file (same hash) and was deleted; the claim flow is re-capture item 2, not this shot.

## Planned shots not yet captured

| # | Screen | Account or state needed | What it proves | Status |
|---|---|---|---|---|
| 1R | New intro sign in screen (intro video, Sign in and Apply fading in) | Signed out, after the design stream ships it | The actual first screen of the shipped app | Re-capture item 1, design not live yet |
| 2 | Claim flow step 1 and step 2 (creator apply) | Signed out, tap through only, no submission | Joining takes about a minute and asks for handle, market, email | Re-capture item 2 |
| 3 | Business join start | Signed out, tap For Businesses | The business door is as clear as the creator door | Not captured, browser failure (below) |
| 4 | Creator home and offers list | The app's designated preview creator account (the admin created test creator, handle previewcreator in code) signed in through a view session, or a dedicated test creator login Jeff approves | Creators see real offers with the comp or rate on the card | Needs a signed in test session; no credentials were available to this run |
| 5 | Business find creators (creator cards ranked by local reach) | The business preview or demo business account, never a real business | Local reach is the headline number on creator cards | Needs a signed in test session |
| 6 | Wallet and money view (creator earnings, payout state) | Same preview creator as shot 4 | Creators can see what they earned and what is held | Needs a signed in test session |
| 7 | QR code surface: creator visit code (My Visits) and business Counter scan screen | Preview creator with a booked visit in preview data, plus the business Counter screen | Creators show their code, businesses scan to redeem; this feature **exists in the live code today** (`/api/bookings/<id>/qr` images on booking cards and a camera scan path on the Counter screen using BarcodeDetector), so it is a capture task, not a build task | Needs a signed in test session with a booked visit |
| 8 | Proof view: Checked in, Posts live, Redeemed | Business preview account | The three step proof model from the listing copy is real in the product | Needs a signed in test session |

Rules followed: only public signed out screens were captured in this run. No real creator or business private data appears in any capture. No screen was faked, mocked, or composited. Signed in shots must use the app's own preview and test accounts (the code contains a designated preview creator and preview business machinery behind an admin session); if Jeff prefers, he can sign in once on the capture machine and the run can proceed from that session.

## Capture session notes (honest log)

- First Playwright run (full Chromium) succeeded and produced shot 1 plus the text verification of the home and `/claim` routes.
- Later runs in the same session failed at browser launch with a Chromium SIGTRAP, on both the full Chromium build and the headless shell, after several retries. The VM was under heavy memory pressure at the time (about 1.6 GB available of 7.9 GB). This is an environment failure, not an app failure: the live app itself returned HTTP 200 and rendered correctly in the successful run.
- Because of that, shots 2 and 3, which need only signed out tap throughs, are listed as re-captures rather than silently dropped.
