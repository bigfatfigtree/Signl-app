# Build -244 proof: Admin Stats Overview

Rendered QA of the new Stats > Overview view against a seeded
local store (dev-server, real background refresh loop), driven
by Playwright at 390px and 1280px. Screenshots:
overview-390.png, overview-desktop.png.

Seed: 6 creators (Nashville 3 approved / 1 pending, Miami 2
approved; 4 finished profiles), 2 businesses (1 approved),
1 completed booking ($85 register spend from 2 counted
customers, $85 visit cost), 1 reported post (1,000 views,
1,060 total engagement), 2 offers, 3 applications, 2 approval
events today, claims tagged pinterest (1) and email (1).

Assertions (all passed, both viewports): every stat card's
number is non-empty; Nashville reads "3 of 50" and sorts
first; all seven sections render (Creators, Growth,
Businesses, Activity, Engagement creator-reported, Revenue,
Downloads); the "Numbers as of" line prints; no preparing
state once the background compute has run. Payload-level
assertions and direct-store spot-checks live in
scripts/verify-build244.mjs (32 checks).
