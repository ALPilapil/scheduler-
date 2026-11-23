# scheduler
Public booking page for EEG sessions. Reads your Google Calendar, works out where you'll be from each event's
Location, and only offers times you can actually reach (faster of transit/bike + 15 min buffer). Bookings land on
your calendar and the participant gets a Google invite. Runs free on Google Apps Script. Rules: [SPEC.md](SPEC.md).

## Files
- `src/content.html` — **all the page text** (description, sections, eligibility checkboxes). Edit freely.
- `src/Code.js` — `CONFIG` at the top: hours, durations, buffer.
- `src/Index.html` — the booking form.
- `test.js` — `node test.js` checks the slot math.

## One-time setup
1. Turn on the Apps Script API: https://script.google.com/home/usersettings
2. Install and log in:
   ```sh
   npm i -g @google/clasp
   clasp login
   ```
3. Create the project (from the repo root):
   ```sh
   clasp create --type standalone --title "EEG Scheduler" --rootDir src
   git checkout src/appsscript.json   # clasp overwrites the manifest; restore ours (needs src/ committed first)
   ```
4. Edit `src/content.html` (compensation etc.), then `clasp push`.
5. `clasp open-script`, then in the editor:
   - **Project Settings → Script properties** → add these (kept out of git):
     - `HOME_ADDRESS` = your real address (never shown to anyone).
     - `MEETING_SPOT` = public place near you where participants meet you, e.g. `Main St Station, Anytown, CA`
       (shown on the booking page).
   - Select the `authorize` function → **Run** → approve the permissions. The log should print your address,
     the meeting spot, and a list of days.
6. Deploy and grab the link:
   ```sh
   clasp deploy -d "v1"          # prints a deployment ID
   clasp open-web-app <DEPLOYMENT_ID>
   ```
   Share that `https://script.google.com/macros/s/.../exec` URL.

## Updating the page
```sh
clasp push && clasp redeploy <DEPLOYMENT_ID>   # same link as before
```
(`clasp deploy` without the ID makes a *new* link.)

## Things to know
- Put real addresses in your calendar events' Location. Empty = home; Zoom/Meet/TBD = wherever you were before.
- Events marked "Free", declined, or all-day don't block time.
- Free Maps quota is ~1,000 route lookups/day. Each day someone checks costs a handful; routes are cached for 6 h.
- To cancel/reschedule, edit or delete the event in your calendar.
