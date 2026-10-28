# Vayun on the web

The same app as the desktop version, running in a browser tab. `build.js` copies the desktop screens
(`desktop/app/`) and adds a browser version of `window.api`, so there is one set of screens to maintain.

| File | What it does |
| :--- | :--- |
| `web-api.js` | Workspaces and pages in the browser (IndexedDB), exports as downloads, "desktop app only" answers for the assistant, Notion and PDF import |
| `web-cloud.js` | Google sign-in (Firebase Auth) and Teams (Cloud Firestore) |
| `team-loader.js` | Runs the desktop's own team code (`team-service.js` and friends) in the browser, unchanged |
| `build.js` | Builds everything into a folder |

## Build and try it

```bash
node web-app/build.js                  # writes web-app/dist
cd web-app/dist && python -m http.server 8099
# open http://127.0.0.1:8099/start.html
```

Put it on the website (the `web/` project serves `web/public/app` as static files):

```bash
node web-app/build.js web/public/app
```

The Firebase web key is read from `desktop/firebase-config.json` (git-ignored) or the `FIREBASE_API_KEY` environment
variable at build time. A web key is visible to anyone who opens the page; that is normal for Firebase, so it is
protected by restrictions, not secrecy (see below).

## One-time setup in your Google accounts (not code)

1. **Firebase sign-in domains.** Firebase console → Authentication → Settings → Authorized domains → add your website's
   domain (for example `yoursite.com`). `localhost` is already allowed. Without this, the Sign in button says the address is
   not allowed.
2. **Restrict the web API key.** Google Cloud console → APIs and services → Credentials → the browser key → Application
   restrictions: HTTP referrers → add `https://yoursite.com/*`. Keep the API restriction to Identity Toolkit and Token
   Service (and Firestore if you also use it from the site).
3. **Google Calendar** uses the same Google sign-in (no second client). The Calendar API must be switched on in the same Google
   Cloud project as Firebase (`vayun-12d1b`), and the consent screen must list the two calendar permissions. The page gets an
   access token that lasts about an hour; after that the Calendar page shows its Sign in with Google button again.

## What works on the web today

| Works | Desktop app only (for now) |
| :--- | :--- |
| Home screen and reminder popup, pages and the block editor, databases, templates, search, themes, HTML import, exports (download), Google Calendar (re-link about hourly) | Assistant, Notion and PDF import, voice typing |
| Sign in with Google, Teams, roles, Must do tasks and team events | |

Pages are kept in the browser they were made in. They do not move between the desktop app and the web.
