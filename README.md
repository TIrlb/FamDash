# FamDash

Family wall dashboard for an old tablet. It cycles between three views (agenda, marble jars, family photo) and is driven from a phone controller.

| Page | Purpose |
|---|---|
| `index.html` | Display (tablet). Cycles views and listens for controller pokes. |
| `control.html` | Parent controller: jar +/-, show a view now, upload photos, settings. |
| `apps-script/Code.gs` | Backend: Google Apps Script web app (calendar, jar state, Drive photos). |

Try it without a backend: open `index.html?demo=1` in one tab and `control.html?demo=1` in another.

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

### 4. Calendars
Subscribe to any team or school calendar in Google Calendar under the backend account. Then go to Controller → Settings → Calendars → Load and tick the ones you want.

## Notes
- Front-end JS is kept to ES2017 (no optional chaining) for old tablet browsers.
- Photos are served base64 through the script, so the folder never has to be link-shared. Uploading through the controller resizes images to 1920px first. Full-size photos added directly to Drive work but load slower.
- Deleting a photo through the API sends it to Drive trash, where it is recoverable for 30 days.
