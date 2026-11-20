# Magpie store listing copy, FINAL (v1.0, for Jeff's review)

Status: FINAL pack, not submitted. Nothing submits until Jeff reviews this copy and signs into his own developer accounts. Canon applied: human facing name is "Magpie" only, US spelling, no em dashes anywhere, creators join free and keep 97 percent, comped visits or paid at the creator's own rate, businesses book local creators ranked by local reach, founding framing is honest. No invented numbers, ratings, testimonials, or results. No feature is promised that the app does not have today.

Facts this copy rests on (verified 2026-11-20): appId com.magpielocal.app, app name Magpie (capacitor.config.json), app loads https://app.magpielocal.com, live signed out screen and live code for offers, bookings, QR redemption, wallet, and the three step visit record (Checked in, Posts live, Redeemed).

## App name (both stores)

Magpie

6 characters. Apple limit 30, Google limit 50.

## Apple subtitle (max 30 characters)

Local influencer marketing

26 characters.

## Google Play short description (max 80 characters)

Local influencer marketing: businesses book nearby creators by local reach.

75 characters.

## Apple promotional text (max 170 characters, can change without a new build)

Local creators, ranked by local reach. Free for creators.

57 characters.

## Full description (both stores, Apple max 4,000 characters, this text about 1,900)

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

## Apple keywords (max 100 characters, comma separated, no spaces)

creator,creators,business,comped,visits,bookings,neighborhood,restaurant,UGC,posts,reach,nearby

95 characters. No word repeats a word in the app name or the subtitle, per Apple guidance.

## Google Play full description

Same text as above. Google allows up to 4,000 characters.

## What's New, version 1.0 (both stores)

Magpie 1.0: local influencer marketing, in an app.
Businesses: find nearby creators ranked by local reach, book comped or paid visits, and track Checked in, Posts live, and Redeemed.
Creators: join free, set your own rate, and keep 97% of paid bookings.

## Categories

Apple: Primary Business. Secondary Lifestyle.
Google Play: Business.

## URLs

Marketing URL: https://magpielocal.com (verified live, HTTP 200 on 2026-11-20)
Privacy policy URL: https://magpielocal.com/privacy.html (verified live, HTTP 200 on 2026-11-20; see privacy-FINAL.md for the policy text updates required before submission)
Support URL: GAP. No dedicated support page exists. https://magpielocal.com/support.html and /contact.html return 404 (checked 2026-11-20). Interim option that resolves today: https://magpielocal.com/creator-faq.html (HTTP 200). Recommendation in jeff-submission-steps.md: add a short support page before submission, or file with the FAQ page. Jeff decides. Both stores require a support URL, so this gap blocks submission until one of the two options is picked.

## Claims cut or kept out, with reasons

1. Push notifications: kept out of the copy entirely. The shell has the push plugin, but the backend push token endpoint and the Firebase and APNs wiring are not in place yet (see privacy-FINAL.md and jeff-submission-steps.md), so the listing must not promise notifications.
2. Prices: no plan prices quoted. Founding prices live on magpielocal.com and can change; the copy points there instead.
3. Counts and social proof: no creator counts, business counts, market counts, download counts, ratings, or testimonials anywhere. None are needed to describe the product and store rules require claims to stay current.
4. The "48 markets" and "decisions within 2 business days" lines that appear on the live signed out screen: kept out of the listing for the same reason as item 3.
5. Camera wording: the copy says staff "scan or enter" the code. Both paths exist in the live code today (camera scan on the Counter screen, manual code entry as the fallback), so the claim stands. See guideline-4.2-evidence.md for the native shell caveat a reviewer will hit.
