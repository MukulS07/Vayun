# Changelog

Every release is a git tag (`vX.Y.Z`) on the commit it was built from, and its installers are attached to the
matching [GitHub Release](https://github.com/MukulS07/Vayun/releases). Installers are not committed to git
(they are 140–270 MB, over GitHub's 100 MB file limit); the Release is where they are kept.

## v1.0.6 — 2026-10-28
- **Multi-calendar Google Calendar sync**: View, create, edit, and delete events across all your Google calendars (primary, secondary, holidays, family) with dedicated calendar colors and selection.
- **Google Calendar sign-in is on in the downloadable installers.** The GitHub builds now get the Google client from repository secrets (v1.0.4 and v1.0.5 were built before they were found, so their Sign in button was disabled).
- The Firebase web API key is no longer in the source code. It is read from a git-ignored `desktop/firebase-config.json` that is packaged into the app; CI writes it from a new `FIREBASE_API_KEY` repository secret (add it before the next release, or the tagged build stops).
- New leak guard: `tools/secret-scan.js` runs in `npm test`/CI and as an optional pre-commit hook (`.githooks/pre-commit`) and blocks key-shaped strings and credential files from being committed.

## v1.0.5 — 2026-10-28
- **Google Calendar sign-in works** in the downloadable installers (v1.0.4's GitHub builds were made before the Google client secrets were added to the repo, so their Sign in button was disabled).
- Each person's Google Calendar stays their own: signing out of Vayun, or a different person signing in, now unlinks the calendar, so the next person never sees someone else's events.

## v1.0.4 — 2026-10-28
- Google Calendar sign-in added to the app (but disabled in the GitHub-built installers; fixed in v1.0.5). Click **Sign in with Google** on the Calendar page to see, create, edit and delete your Google events.
- The Google OAuth client is read from a git-ignored `desktop/gcal-client.json`; CI writes it from the `GCAL_CLIENT_ID` / `GCAL_CLIENT_SECRET` repository secrets, so the secret never enters the public repo.
- The macOS build retries up to 3 times, because DMG creation on GitHub's runners fails at random.

## v1.0.3 — not released
Tag only, on the same commit as v1.0.2. Its build failed and no Release was made. Use v1.0.4.

## v1.0.2 — 2026-10-27
- **New Calendar page**: month and week views of workspace events, dated database rows and (when linked) Google Calendar events; the database Calendar view is now a month grid.
- Google Calendar sign-in code shipped, but this release has no OAuth client bundled, so the Sign in button is disabled. Fixed in v1.0.4.
- Builds go to `desktop/release/<version>/`; pushing a `v*` tag builds Windows and macOS (Apple Silicon, Intel, Universal) and publishes the Release.
- App icon regenerated at 1024×1024 (macOS needs at least 512×512); the optional `@napi-rs/canvas` module is left out of the app.

## v1.0.1 — 2026-10-23
- Bundled default Firebase config so the standalone installer can sign in without a `.env` file.

## v1.0.0 — 2026-10-23
- First release: local-first notes and planners, AI assistant, templates, imports and exports, Windows installer and macOS builds.
- Browser-based Firebase **Sign in with Google** and Vayun branding.
