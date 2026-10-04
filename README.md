# PersonalFlow

A private, single-user productivity dashboard: tasks with priority, category, due date and time, search, filters, stats, dark/light mode, reminders, and optional Google Drive sync between devices. It installs as an app on your phone (PWA).

Static frontend only (HTML, CSS, vanilla JavaScript). No backend, no build step.

## Features

- Create, edit, delete (with confirmation) and complete tasks
- Priority, category, due date, optional due time (clock picker on mobile), description
- Your own categories: choose "+ New category..." in the task form
- Views: Overview, My Tasks, Today, Upcoming, Completed, per-category
- Instant search (title, description, category) and filters
- Light / Dark / System theme
- Works offline (LocalStorage + service worker cache)
- Install as an app (Chrome: Install app / Add to Home screen)
- Reminders (Settings): a daily summary and a notification at each timed task's due time
- "Add to Google Calendar" button on tasks with a due date (timed or all-day event)
- Optional sync between PC and phone through one JSON file in your Google Drive
- Export JSON / CSV, validated JSON import, recovery copies

## Project structure

```text
personalflow/
├── index.html
├── manifest.webmanifest   PWA manifest
├── sw.js                  service worker (offline cache, notifications)
├── README.md
├── .gitignore
├── assets/                avatar.png, favicon files
├── css/   variables, base, layout, components, modal, views, sync, data, responsive
└── js/
    ├── app.js            start-up
    ├── config.js         Google Client ID (public, not a secret)
    ├── state.js          in-memory data + change notifications
    ├── storage.js        LocalStorage, data validation, recovery copies
    ├── tasks.js          task CRUD, categories, dates, stats
    ├── filters.js        search and filtering rules
    ├── ui.js             rendering, dialogs, navigation
    ├── theme.js          light / dark / system
    ├── dialogs.js        reusable confirm dialog
    ├── backup.js         export / import / clear data
    ├── notifications.js  reminders
    ├── google-auth.js    Google Identity Services sign-in
    ├── google-drive.js   Drive REST calls
    └── sync.js           sync engine, status, conflict handling
```

## Run locally

JavaScript modules need a web server (double-clicking `index.html` will not work).

- VS Code: install the **Live Server** extension, then click **Go Live** (port 5500).
- Or: `npx serve -l 5500 .`

Open the app at the exact origin you registered in Google Cloud (`http://127.0.0.1:5500` or `http://localhost:5500`).

The app is fully usable without Google Drive.

## Google Drive sync setup (one time)

1. Google Cloud Console: create a project, enable **Google Drive API**.
2. Configure the OAuth consent screen (External, Testing) and add your Google account as a **Test user**.
3. Add the scope `https://www.googleapis.com/auth/drive.file` (only this one).
4. Create an **OAuth client ID** of type **Web application**.
5. Add **Authorized JavaScript origins** (origin only: no path, no trailing slash):
   - `http://localhost:5500`
   - `http://127.0.0.1:5500`
   - your deployed origin, e.g. `https://mujahidalitodo.vercel.app`
6. Paste the Client ID into `js/config.js`. Do not create or store a client secret: it is not needed.

The app only sees the file it creates (`personalflow-data.json`), thanks to the `drive.file` scope.

### How sync behaves

- Edits upload automatically a couple of seconds after you make them.
- Google sign-in tokens last about 1 hour and are kept in memory only. After that the status shows **Sign in to sync**: press **Sync Now** in Settings.
- If Google Drive has newer data, or both sides changed, you are asked what to do. Nothing is overwritten silently, and the replaced version is kept as a recovery copy on the device (Settings, Data, Download latest).
- Offline changes stay on the device and sync when you are back online.
- Categories and due times are part of each task, so they sync automatically.

## Reminders: what to expect

Reminders are local to each device (browser notifications through the service worker). They fire while the app is open or still running in the background.

- Settings, Reminders: turn on, pick the daily time, press Test.
- Daily summary: today's, overdue and tomorrow's tasks.
- Timed tasks: a notification at the due time (only if the app is alive within about 15 minutes of that time).
- There is no server, so a phone that has fully stopped the app cannot be woken at an exact time. For alarms that always ring, use **Add to Google Calendar** on the task.
- On Android, allow notifications for the installed app in system settings if they do not appear.

## Deploy to GitHub Pages

1. Create an empty repository on GitHub (no README, no .gitignore).
2. In the project folder:

```bash
git init
git add .
git commit -m "Initial PersonalFlow app"
git branch -M main
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main
```

3. GitHub: repository **Settings, Pages, Build and deployment**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)**, Save.
4. After a minute or two the site is at `https://USERNAME.github.io/REPOSITORY/`.
5. In Google Cloud, add `https://USERNAME.github.io` to Authorized JavaScript origins.

## Deploy to Vercel

1. Push the repository to GitHub (as above).
2. vercel.com: **Add New, Project**, import the repository.
3. Framework Preset: **Other**. Leave Build Command and Output Directory empty. Deploy.
4. Add `https://YOUR-PROJECT.vercel.app` to Authorized JavaScript origins in Google Cloud.

## Updating the app

```bash
git add .
git commit -m "Describe your change"
git push
```

GitHub Pages and Vercel redeploy automatically. The service worker fetches the network version first, so you always get the latest files when online.

## Known limits

- A category is stored with its tasks, so an empty category disappears from the sidebar. To rename or merge a category, edit the category of its tasks.
- Reminders cannot wake a fully stopped phone (see above).
- The app icon uses `assets/avatar.png` for all sizes. For crisper install icons, add real 192x192 and 512x512 PNGs and point `manifest.webmanifest` to them.

## Security notes

- Never commit a client secret, token, or credentials file. `.gitignore` blocks common names.
- The Google Client ID is public by design. Its safety comes from the Authorized JavaScript origins list.
- No analytics, no third-party scripts other than Google Sign-In and Google Fonts.

## Final testing checklist

Tasks
- [ ] Add, edit, delete (with confirmation) and complete a task
- [ ] Empty title shows "Title is required."
- [ ] Due time: field enables after choosing a date, clears if the date is removed
- [ ] Same-day tasks are ordered by time
- [ ] Custom category: "+ New category..." creates it, it appears in the sidebar and filters
- [ ] Today, Upcoming, Completed, category views and filters behave correctly
- [ ] Search finds by title, description and category
- [ ] Data survives a page refresh
- [ ] Light, Dark and System themes persist after refresh

Responsive and accessibility
- [ ] Desktop sidebar layout; phone layout with bottom nav and "+" button
- [ ] No horizontal scrolling at 360px width
- [ ] Whole app usable with keyboard only (Tab, Enter, Esc; "Skip to main content" works)

PWA and reminders
- [ ] Favicon and logo show; DevTools, Application shows the manifest and an active service worker
- [ ] App opens offline after one online visit
- [ ] Phone: Install app works and the icon is the avatar
- [ ] Reminders: Turn on, Allow, Test notification appears, tapping it opens the app
- [ ] A timed task due in 2 minutes notifies at its time (app open)
- [ ] Add to Google Calendar opens a prefilled event (timed or all-day)

Backup
- [ ] Export JSON and CSV open correctly (CSV includes dueTime)
- [ ] Importing a broken file shows "Invalid backup file" and changes nothing
- [ ] Importing a valid file replaces tasks after confirmation
- [ ] Clear local data asks for confirmation and does not delete the Drive file

Google Drive
- [ ] Connect creates `personalflow-data.json` in Drive
- [ ] A new task syncs automatically (Changes pending, Syncing, Synced)
- [ ] Second device (or Incognito) loads the data after connecting
- [ ] Offline edits sync after going back online
- [ ] Conflict dialog appears when both sides changed
- [ ] Disconnect keeps local data

Deployment
- [ ] Deployed site loads with no console errors
- [ ] Google sign-in works on the deployed origin
- [ ] Phone and PC show the same tasks after sync