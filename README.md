# 🍃 Vayun

> **A fast, local-first workspace for notes, planners, and an AI assistant.**  
> 100% private, offline-ready, and stored directly on your computer.

[![Build Desktop Apps](https://github.com/MukulS07/Vayun/actions/workflows/build.yml/badge.svg)](https://github.com/MukulS07/Vayun/actions/workflows/build.yml)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)](https://github.com/MukulS07/Vayun)
[![Apple Silicon](https://img.shields.io/badge/Apple%20Silicon-M1%20%2F%20M2%20%2F%20M3%20%2F%20M4-success)](https://github.com/MukulS07/Vayun)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## ✨ Features

- 🔒 **Local-First & Offline** — No cloud lock-in or forced subscriptions. All data is saved on your device as human-readable JSON.
- ✍️ **Block-Based Editor** — Clean writing canvas supporting Markdown, headers, checklists, code blocks, quotes, and dividers.
- 🗂️ **Workspaces & Databases** — Create multiple isolated workspaces with customizable database views (Tables, Boards, Calendars).
- 📅 **Calendar with Google Calendar sync** — Month and week views of your workspace events and dated database rows; link Google Calendar to see, create, edit and delete your Google events from Vayun.
- 🏠 **Home landing screen** — Vayun opens on what needs you today: a *Start here* card for the one thing to do first, counts of overdue and due-soon work, and lists for must-do tasks, important work, today's calendar, your own reminders and pinned pages. A small reminder popup (Open task, Snooze 1 hour) shows when a must-do or overdue task is waiting. Switch sections on or off; it follows your theme.
- 👥 **Team tasks & shared calendar, with roles** — admins, leads and members. Admins and leads give tasks (and can flag a task *Must do*); everyone sees theirs, sorted and grouped however they like; team events show on everyone's Calendar. Free, on Firebase's free plan (one-time [setup](docs/team-setup.md)).
- 🤖 **Native AI Assistant** (<kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>) — Draft, summarize, ideate, and structure content without leaving your workflow.
- ⚡ **Global Quick Search** (<kbd>⌥⌘K</kbd> / <kbd>Ctrl+Alt+K</kbd>) — Find any note instantly from anywhere in your operating system.
- ⏱️ **Built-in Productivity Tools** — Study timers, Pomodoro counters, habit trackers, and interactive mind maps.
- 🔄 **One-Click Imports & Exports** — Import Notion `.zip` exports, PDFs, and HTML files; export your pages to Markdown, HTML, or CSV.
- 🎨 **Modern Minimal Design** — Custom frameless UI with native macOS traffic lights and Windows themed title bar.

---

## 📥 Downloads & Installation

Pre-built binaries are automatically compiled via GitHub Actions:

### 🍎 macOS (Apple Silicon & Intel)
1. Download the latest **`Vayun-<version>-arm64.dmg`** (Apple Silicon) or **`Vayun-<version>-universal.dmg`** (Intel & Apple Silicon) from [**Releases**](https://github.com/MukulS07/Vayun/releases/latest).
2. Open the `.dmg` file and drag **Vayun** into your **Applications** folder.
3. Launch **Vayun** from Spotlight or Launchpad.

> *Note for macOS:* Because Vayun is independently developed without an expensive Apple Developer ID, if Gatekeeper shows *"Vayun can't be opened"*, simply right-click `Vayun.app` → click **Open**, or go to **System Settings → Privacy & Security** and click **Open Anyway**.

### 🪟 Windows (x64)
1. Download **`Vayun-Setup-<version>.exe`** from [**Releases**](https://github.com/MukulS07/Vayun/releases/latest).
2. Run the installer to add Vayun to your Start Menu and Desktop.

---

## 🗒️ Release history

Every release is a git tag on the exact commit it was built from, with its installers attached to the matching [GitHub Release](https://github.com/MukulS07/Vayun/releases). The full details of each one are in [CHANGELOG.md](CHANGELOG.md).

| Version | Date | What it brought |
| :--- | :--- | :--- |
| [**v1.0.7**](https://github.com/MukulS07/Vayun/releases/tag/v1.0.7) | 2026-10-28 | **Home screen, team roles and reminders.** Vayun opens on a Home screen with a *Start here* card and a reminder popup. Teams get admin, lead and member roles, *Must do* tasks and shared team events, on Cloud Firestore's free plan. |
| [v1.0.6](https://github.com/MukulS07/Vayun/releases/tag/v1.0.6) | 2026-10-28 | **Every Google calendar, and no keys in the code.** View, create, edit and delete events across all your Google calendars. API keys moved out of the source into repository secrets, with a leak guard in tests and CI. |
| [v1.0.5](https://github.com/MukulS07/Vayun/releases/tag/v1.0.5) | 2026-10-28 | **Google Calendar sign-in works in the installers.** Each person's calendar stays their own: signing out or switching accounts unlinks it. |
| [v1.0.4](https://github.com/MukulS07/Vayun/releases/tag/v1.0.4) | 2026-10-28 | **Google Calendar sign-in** added to the app (disabled in the GitHub-built installers; fixed in v1.0.5). macOS builds retry when DMG creation fails at random. |
| v1.0.3 | not released | Tag only. Its build failed and no release was made; use v1.0.4. |
| [v1.0.2](https://github.com/MukulS07/Vayun/releases/tag/v1.0.2) | 2026-10-27 | **The Calendar page and one-command releases.** Month and week views, a month-grid database Calendar view, a folder per version, and a tag-triggered build of every installer. |
| [v1.0.1](https://github.com/MukulS07/Vayun/releases/tag/v1.0.1) | 2026-10-23 | **Sign-in works out of the box** in the standalone installer. |
| [v1.0.0](https://github.com/MukulS07/Vayun/releases/tag/v1.0.0) | 2026-10-23 | **The first release.** Local-first notes and planners, AI assistant, templates, imports and exports, Windows installer and macOS builds, Sign in with Google. |

---

## 📅 Google Calendar

Open **Calendar** in the sidebar and click **Sign in with Google**. Approve access in your browser and your Google events appear next to your workspace events — create, edit and delete them right from Vayun. **Sign out** on the Calendar page disconnects it.

Vayun syncs your primary calendar. The sign-in token is encrypted with the OS keychain (Electron `safeStorage`) and stays on your computer.

<details>
<summary>For maintainers: the bundled Google OAuth client</summary>

Calendar sign-in uses Vayun's own Google OAuth client (type **Desktop app**, project `vayun-12d1b`, scope `calendar.events`). The client ID and secret are **not committed**: locally they live in `desktop/gcal-client.json` (git-ignored, packaged into the app) as `{ "clientId": "…apps.googleusercontent.com", "clientSecret": "GOCSPX-…" }`, and GitHub Actions writes the same file from the `GCAL_CLIENT_ID` and `GCAL_CLIENT_SECRET` repository secrets (Settings → Secrets and variables → Actions). Without them a build still works but the Sign in button is disabled. Until Google verifies the consent screen, people see an "unverified app" warning (**Advanced → Go to Vayun**) and sign-ins are capped at 100. For local testing you can also override the client with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `desktop/.env.local`.

The Firebase web key used for Vayun sign-in follows the same pattern: `desktop/firebase-config.json` locally (`{ "apiKey": "AIza…" }`, git-ignored and packaged), and the `FIREBASE_API_KEY` repository secret in CI. A tagged release build fails if that secret is missing.

**Keeping keys out of git:** `node tools/secret-scan.js` (also run by `npm test`, so CI catches it) fails if a key-shaped string or a credential file such as `.env`, `gcal-client.json` or `firebase-config.json` is tracked. To block such commits locally too, run once per clone: `git config core.hooksPath .githooks`.
</details>

---

## ⌨️ Keyboard Shortcuts

| Shortcut (macOS) | Shortcut (Windows) | Action |
| :--- | :--- | :--- |
| <kbd>⌘</kbd> + <kbd>K</kbd> | <kbd>Ctrl</kbd> + <kbd>K</kbd> | Search within active workspace |
| <kbd>⌥</kbd> + <kbd>⌘</kbd> + <kbd>K</kbd> | <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>K</kbd> | Global Quick Search (from any app) |
| <kbd>⌘</kbd> + <kbd>J</kbd> | <kbd>Ctrl</kbd> + <kbd>J</kbd> | Toggle AI Assistant panel |
| <kbd>⌘</kbd> + <kbd>N</kbd> | <kbd>Ctrl</kbd> + <kbd>N</kbd> | Create a new page |
| <kbd>⌘</kbd> + <kbd>Enter</kbd> | <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Exit code block / confirm block |
| <kbd>⌘</kbd> + <kbd>W</kbd> | <kbd>Ctrl</kbd> + <kbd>W</kbd> | Close current tab / window |

---

## 🛠️ Development & Building from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- `npm`

### Quickstart
```bash
# Clone the repository
git clone https://github.com/MukulS07/Vayun.git
cd Vayun/desktop

# Install dependencies
npm install

# Run the app locally
npm start

# Run the test suite
npm test
```

### Packaging & Distribution

```bash
# Build for macOS (Apple Silicon arm64 DMG & ZIP)
npm run dist:mac

# Build for macOS (Universal binary: Apple Silicon + Intel)
npm run dist:mac:universal

# Build for Windows (NSIS Setup .exe)
npm run dist:win
```

Builds land in a folder per version: `desktop/release/<version>/` (for example `desktop/release/1.0.7/Vayun-Setup-1.0.7.exe`), so older builds are kept side by side.

### Releasing an update to every platform

1. Bump the version in `desktop/package.json` (for example `npm version 1.0.8 --no-git-tag-version` inside `desktop/`).
2. Add a `## v1.0.8 — <date>` section to [CHANGELOG.md](CHANGELOG.md) with a one-line `> tagline` under the heading and a bullet list of what changed, add the version to the table above, and commit. The release title and description are generated from that section, and a tag with no changelog entry stops the release job before anything is published.
3. Tag and push:
   ```bash
   git tag v1.0.8
   git push origin master --tags
   ```
4. GitHub Actions builds the Windows `.exe` and the macOS `.dmg`/`.zip` (Apple Silicon, Intel and Universal) and publishes them together as the **Vayun v1.0.8 — <your tagline>** release, with the changelog text as its description and a table saying which file to download.

---

## 🛡️ Privacy & Architecture

Vayun operates entirely on a local-first paradigm:
- **Zero telemetry or tracking.**
- Data is stored locally in your OS application support directory (`%APPDATA%/Pages` on Windows, `~/Library/Application Support/Pages` on macOS).
- Database structures and markdown content use atomic file operations to prevent file corruption during crashes or abrupt system shutdowns.
- **Teams are the one exception:** the tasks, team events and member names of a team you join are stored in Google's Cloud Firestore so everyone in the team can see them. Your personal pages and notes never leave your PC, and signing out removes the local copy of team data.

---

## 👤 Author

**Maytrix**  
Developed by **Mukul Sharma** ([@MukulS07](https://github.com/MukulS07))  
GitHub: [https://github.com/MukulS07/Vayun](https://github.com/MukulS07/Vayun)
