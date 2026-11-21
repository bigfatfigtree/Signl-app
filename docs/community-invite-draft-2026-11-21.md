# Community invite: all-creators in-app message (DRAFT, DO NOT SEND)

Status: **draft only**. Nothing has been sent. Sending waits for Jeff's tap on this exact copy.
Companion pieces (same bundle, Build -231): the creator profile community card (+10 Momentum on "I joined") and the community block in the creator approval email.

Group URL: the message uses the single `GROUP_URL` constant (router.js / app.js).
The group is LIVE: "Magpie Creators", public, administered by the Magpie Local Page,
at `https://www.facebook.com/groups/1820148515703356`. GROUP_URL carries that real URL
in both files (Build -231). Before sending, confirm the link in the copy below matches
GROUP_URL character for character.

Copy note: the "brand new" / founding framing is deliberate while the group is small.
It is a one-line template edit in this draft (and in the approval email block and the
profile card line) to retire once the group is full.

---

## Draft message copy (verbatim, Maggie voice)

> Hi, Maggie here. We just opened our brand new Facebook group for Magpie creators, and I would love to have you in from the very start. Everyone who joins now is a founding member.
>
> Inside, creators share wins, ask questions, and hear about opportunities first. Join here: https://www.facebook.com/groups/1820148515703356
>
> One small bonus: after you join, open your profile in the app and tap I joined on the community card. That earns you +10 Momentum.
>
> Thanks for being part of this from the beginning.
>
> Maggie

Plain-text body as it would be sent (one string, blank lines between paragraphs):

```
Hi, Maggie here. We just opened our brand new Facebook group for Magpie creators, and I would love to have you in from the very start. Everyone who joins now is a founding member.

Inside, creators share wins, ask questions, and hear about opportunities first. Join here: https://www.facebook.com/groups/1820148515703356

One small bonus: after you join, open your profile in the app and tap I joined on the community card. That earns you +10 Momentum.

Thanks for being part of this from the beginning.

Maggie
```

Length: about 560 characters, well under the route's 4,000 character cap (PLATFORM_MESSAGE_MAX).
No em dashes. US spelling.

---

## Send mechanism (exact)

Route: `POST /api/admin/platform-messages` with an admin session. This is the platform
thread route (the same route used for Creator messages thread replies). **Never** use
Admin → Messages → "Write a message" for this; that is the broadcast composer and is
not this send path.

The route has exactly three recipient scopes, and there is no single all-creators scope:

1. `{ userId }` or `{ creatorId }`: one person.
2. `{ market }`: a market segment. This is the scope this invite uses.

So the all-creators invite is **one POST per market**, body `{ "market": "<Market name>", "body": "<the copy above>" }`,
sent once for each market that has recipients (34 markets, listed below). Each segment
send is recorded by the route as one `pmcampaign:*` receipt (kind "segment", with the
exact body and recipient id list) plus a `platform_message_segment` event, so the whole
invite is auditable in Admin → Messages under "Sent to many".

### Who a segment send reaches (the route's own filter)

For market M, recipients are every stored user where:

- `isRosterCreator(u)`: role is creator, status is approved, not a tester, and
- `profileCompleteOf(u)`: the profile is finished (handle, home city, audience of at
  least 500 stacked, at least one category, local audience % reported), and
- `standingState(u)` is not "banned", and
- the record's market normalizes to M.

Each recipient gets the message in their in-app platform thread, and the route also
sends the email copy (`platformMessageEmail`) unless it is suppressed by the
recent-lifecycle-email window, which the response counts as emailSuppressed.

### How the recipient count is known

- The route answers each call with `{ sent, recipients, emailSent, emailFailed, emailSuppressed, scope, market }`.
  The invite's true recipient count is the **sum of `sent` across the per-market calls**,
  read from those responses (and cross-checked against the pmcampaign receipts).
- Ceiling, from the live recount of 2026-11-21 (data-accuracy run): **183 approved
  creators across 34 markets**, out of 193 signed up. The segment filter reaches the
  finished-profile subset of those 183, so the delivered count will be at or below 183
  and is only exact at send time.
- Approved creators by market (live recount, 2026-11-21): Nashville 47, Virginia Beach 29,
  Richmond 11, Austin 11, Miami 11, Atlanta 9, Los Angeles 7, Washington DC 6, Raleigh 6,
  New York City 5, Toronto 5, Chicago 3, Denver 3, Seattle 3, Charlotte 2, Baltimore 2,
  Dallas 2, Philadelphia 2, Charlottesville 2, Las Vegas 2, Dublin 2, Boston 1,
  San Diego 1, Tampa 1, Pittsburgh 1, Columbus 1, Houston 1, San Antonio 1, London 1,
  Amsterdam 1, Copenhagen 1, Lisbon 1, Montreal 1, Auckland 1.

### Who this invite does not reach

- Creators still pending approval (they get the community block in their approval email
  when Jeff approves them).
- Approved creators whose profiles are not finished (the profile card is waiting for
  them in the app; the segment route only addresses finished profiles, the same rule
  that keeps unfinished profiles off the roster).

---

## Send checklist (for when Jeff taps go)

1. Confirm GROUP_URL in router.js and app.js is the live group URL
   (https://www.facebook.com/groups/1820148515703356), and that the link in the copy
   above matches it character for character.
2. One controlled test first: send the copy to a single controlled test creator via
   `{ creatorId }`, read it back in that thread, confirm the link renders.
3. Then one `{ market }` POST per market with recipients, smallest market first,
   recording each response's `sent` / email counts in the run log.
4. Sum `sent` across markets and report the total to Jeff with the pmcampaign receipt ids.
5. One message per recipient, worked from the per-market list. No re-sends.
