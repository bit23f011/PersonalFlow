# PersonalFlow

A private, single-user productivity dashboard: tasks, priorities, categories, due dates, search, filters, stats, dark/light mode, and optional Google Drive sync between devices.

Static frontend only (HTML, CSS, vanilla JavaScript). No backend, no build step.

## Features

- Create, edit, delete and complete tasks (priority, category, due date, description)
- Overview, My Tasks, Today, Upcoming, Completed, and category views
- Instant search (title, description, category) and filters
- Light / Dark / System theme
- Works offline: data lives in browser LocalStorage
- Optional sync between PC and phone through one JSON file in your Google Drive
- Export JSON / CSV, validated JSON import, recovery copies

## Project structure

```text
personalflow/
├── index.html
├── README.md
├── .gitignore
├── css/   variables, base, layout, components, modal, views, sync, data, responsive
└── js/
    ├── app.js          start-up
    ├── config.js       Google Client ID (public, not a secret)
    ├── state.js        in-memory data + change notifications
    ├── storage.js      LocalStorage, data validation, recovery copies
    ├── tasks.js        task CRUD, dates, stats
    ├── filters.js      search and filtering rules
    ├── ui.js           rendering, dialogs, navigation
    ├── theme.js        light / dark / system
    ├── dialogs.js      reusable confirm dialog
    ├── backup.js       export / import / clear data
    ├── google-auth.js  Google Identity Services sign-in
    ├── google-drive.js Drive REST calls
    └── sync.js         sync engine, status, conflict handling
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
   - `https://USERNAME.github.io` (GitHub Pages: no repository name)
   - `https://YOUR-PROJECT.vercel.app`
6. Paste the Client ID into `js/config.js`. Do not create or store a client secret: it is not needed.

The app only sees the file it creates (`personalflow-data.json`), thanks to the `drive.file` scope.

### How sync behaves

- Edits upload automatically a couple of seconds after you make them.
- Google sign-in tokens last about 1 hour and are kept in memory only. After that the status shows **Sign in to sync**: press **Sync Now** in Settings.
- If Google Drive has newer data, or both sides changed, you are asked what to do. Nothing is overwritten silently, and the replaced version is kept as a recovery copy on the device (Settings, Data, Download latest).
- Offline changes stay on the device and sync when you are back online.

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

GitHub Pages and Vercel redeploy automatically.

## Security notes

- Never commit a client secret, token, or credentials file. `.gitignore` blocks common names.
- The Google Client ID is public by design. Its safety comes from the Authorized JavaScript origins list.
- No analytics, no third-party scripts other than Google Sign-In and Google Fonts.

## Final testing checklist

Local features
- [ ] Add, edit, delete (with confirmation) and complete a task
- [ ] Empty title shows "Title is required."
- [ ] Today, Upcoming, Completed, category views and filters behave correctly
- [ ] Search finds by title, description and category
- [ ] Data survives a page refresh
- [ ] Light, Dark and System themes persist after refresh

Responsive and accessibility
- [ ] Desktop sidebar layout; phone layout with bottom nav and "+" button
- [ ] No horizontal scrolling at 360px width
- [ ] Whole app usable with keyboard only (Tab, Enter, Esc; "Skip to main content" works)

Backup
- [ ] Export JSON and CSV open correctly
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