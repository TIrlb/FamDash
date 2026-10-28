# FamDash

Family wall dashboard for an old tablet, driven from a phone controller. It cycles through these views (each can be turned off in Settings, and views with nothing to show are skipped):

| View | Source |
|---|---|
| Agenda | Google Calendar (family + any subscribed calendars) |
| Marble jars | Backend state; 1–4 kids side by side, or one combined family jar |
| Photo | Drive folder "FamDash Photos" |
| Lunch menu | School lunch flyer, split into this week's days (Mon–Wed over Thu–Fri + daily options) by detecting the flyer's grid; full month if the grid isn't found |
| Weather | National Weather Service api.weather.gov (now, 10-hour, 5-day; US only, public domain) + the NWS radar loop for the family's ZIP code |
| Scores | ESPN scoreboards: the day's top games in the chosen leagues (+ last night's finals before 11am); favorite teams featured the day before, day of, and morning after their games |
| Fantasy | ESPN fantasy API (public league): matchups with each roster's top 3 performers, standings; holds last week's finals on Tue/Wed |
| Quote wall | Drive folder "FamDash Quotes" |
| Gratitude | Text notes added from the controller |
| Today | One sports moment (a US sports event on this date, else the best-known athlete born today) + one history event (ranked by Wikipedia pageviews, nudged toward US events), and one "Today is National ___ Day" picked from Checkiday's list (food/animals/play over health/causes) |

| Page | Purpose |
|---|---|
| `index.html` | Display (tablet). Cycles views and listens for controller pokes. |
| `control.html` | Parent controller: jar +/-, show a view now, upload photos, settings. |
| `apps-script/Code.gs` | Backend: Google Apps Script web app (calendar, jar state, Drive photos). |

Try it without a backend: open `demo.html` (tablet + phone side by side, live), or `index.html?demo=1` and `control.html?demo=1` in two tabs. Demo photos are from [Unsplash](https://unsplash.com) (Unsplash License); the demo lunch flyer is generated in the browser.

## Architecture

```
phone (control.html) ──POST──▶ Apps Script ──▶ Script properties (jars/settings)
        │                         │──▶ CalendarApp (family + subscribed calendars)
        │                         └──▶ Drive folder "FamDash Photos"
        └──poke──▶ ntfy.sh topic ──SSE──▶ tablet (index.html) ──GET──▶ Apps Script
```

- **No secrets in the repo.** The API URL and token are stored in each device's localStorage. They are provisioned once via a link of the form `?api=…&token=…`, which the page strips from the URL after saving.
- **ntfy carries pokes only**, e.g. `{"type":"jar"}` or `{"type":"show","view":"photo"}`, never data. The topic name is random. If ntfy is down, the display still polls state every 5 min and events every 10 min.
- The display reloads itself nightly at 3am.

## Setup

### 1. Backend (Apps Script, as tony@irlbecktech.com)
1. Go to script.google.com and create a new project named **FamDash API**. Replace `Code.gs` with `apps-script/Code.gs` from this repo.
2. Select `setup`, then click **Run** and authorize. The execution log shows the **TOKEN**, the ntfy topic, and the Drive photo folder link.
3. Go to **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then copy the `/exec` URL.
   - If **Anyone** isn't offered, the irlbecktech.com tenant is blocking external sharing. In Admin console, go to Apps → Google Workspace → Drive and Docs → Sharing settings and allow sharing outside the domain.
4. To ship backend changes later, use **Deploy → Manage deployments → Edit → New version**. This keeps the same URL.

### 2. Controller
Open `https://tirlb.github.io/famdash/control.html?api=<EXEC_URL>&token=<TOKEN>` on your phone. Optionally use Share → Add to Home Screen.

From **Settings → Links**, send the controller link to the other parent and the display link to the tablet.

### 3. Display (tablet)
1. Open the display link.
2. Keep the screen on and lock the tablet to this page:
   - **iPad:** Settings → Display → Auto-Lock **Never**, then Guided Access.
   - **Android:** Fully Kiosk Browser (free tier) or screen-timeout max + screen pinning.

### 4. Family settings
Everything family-specific lives in the controller's Settings (stored in the backend), so the same code serves any family. A fresh backend starts with two jars named "Kid 1" and "Kid 2", no location, and no lunch or fantasy league. Until the ZIP and kid names are set, the controller shows a **Finish setting up** card.

| Setting | Notes |
|---|---|
| ZIP code | The controller looks it up with zippopotam.us and api.weather.gov, then stores the town, coordinates, radar station and time zone. Weather is hidden until this is set. |
| Units | °F or °C |
| Kids | 1–4 jars. Add and remove save right away; name, goal and count edits go through the Save bar. |
| School lunch | Lunch page URL, an optional files folder base for guessing the flyer's file name, or a direct image URL |
| Teams, scores leagues, fantasy league ID | Optional |

### 5. Calendars
Subscribe to any team or school calendar in Google Calendar under the backend account. Then go to Controller → Settings → Calendars → Load and tick the ones you want.

## Updating the backend
Front-end changes go live when GitHub Pages rebuilds. Changes to `apps-script/Code.gs` need a paste into the Apps Script editor followed by **Deploy → Manage deployments → Edit → New version**. New views join the rotation automatically, once.

ESPN's site and fantasy APIs are unofficial and undocumented. If ESPN changes them, the Scores or Fantasy view will drop out of the rotation rather than break the display.

## Notes
- Front-end JS is kept to ES2017 (no optional chaining) for old tablet browsers.
- Photos are served base64 through the script, so the folder never has to be link-shared. Uploading through the controller resizes images to 1920px first. Full-size photos added directly to Drive work but load slower.
- Deleting a photo through the API sends it to Drive trash, where it is recoverable for 30 days.
