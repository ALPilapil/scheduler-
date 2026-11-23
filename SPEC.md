# EEG Session Scheduler — Spec

Public booking link for EEG data-collection sessions. Availability = Google Calendar + travel time.

## Platform
- Google Apps Script web app (free). Calendar, Maps (directions), invites all built in.
- Code + page text live in this repo; deploy with `clasp push && clasp deploy` (same URL each time).
- Timezone: America/Los_Angeles.

## Editable content (`content.html`)
- Title, short description, sections (what to expect, compensation, prep, FAQ), eligibility checkbox wording.
- Duration disclaimer: 90 min for the first person, +60 min per extra household member.
- "Come to me" copy: meet at a public spot near the apartment, then go up to the apartment for the session.

## Config (top of `Code.gs`)
- Home address (real; used for travel math only, never shown).
- Public meeting spot (shown on the page and in the invite).
- Hours 9am–9pm, booking 12h–14d ahead, 30-min start increments, 15-min travel buffer.

## Booking flow
1. Choose: **I come to you** (enter address, geocoded/validated) or **You come to me** (meeting spot shown).
2. Number of people (unlimited; their call, with the disclaimer). Duration = 90 + 60·(n−1) min.
3. Pick a day (days fully booked on the calendar are greyed out, no Maps calls), then see the times that work.
4. Form: name, email (required); phone, notes/access instructions, eligibility checkboxes (optional).
5. Book → event created on primary calendar, participant added as guest (Google invite = confirmation).
   Event location = session address, so later bookings chain travel off it.
6. Changes/cancellation: participant replies/emails; owner edits the event manually.

## Availability rules
- Busy = primary calendar events not marked "Free". All-day events ignored.
- Your location during an event = its Location field, geocoded. Non-places (Zoom, Meet, TBD, unparseable)
  → wherever you were before; first of the day → home. Before first / between events with no location → home.
- Slot valid if:
  - starts ≥ 9am, ends ≤ 9pm, within 12h–14d window;
  - reachable from previous location: prev end + travel + 15 min ≤ slot start;
  - next event reachable: slot end + travel + 15 min ≤ next start.
- Travel = faster of transit vs bicycling, at the real departure/arrival time.
- No max travel distance. Trip home after the last session is not checked.
- Re-check under a lock at booking time (two people can't grab the same slot).

## Quota guardrails (free tier ~1,000 directions/day)
- Compute only the selected day; one lookup pair per gap, not per slot.
- Cache geocodes and routes (CacheService).
