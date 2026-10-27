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
- 🤖 **Native AI Assistant** (<kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>) — Draft, summarize, ideate, and structure content without leaving your workflow.
- ⚡ **Global Quick Search** (<kbd>⌥⌘K</kbd> / <kbd>Ctrl+Alt+K</kbd>) — Find any note instantly from anywhere in your operating system.
- ⏱️ **Built-in Productivity Tools** — Study timers, Pomodoro counters, habit trackers, and interactive mind maps.
- 🔄 **One-Click Imports & Exports** — Import Notion `.zip` exports, PDFs, and HTML files; export your pages to Markdown, HTML, or CSV.
- 🎨 **Modern Minimal Design** — Custom frameless UI with native macOS traffic lights and Windows themed title bar.

---

## 📥 Downloads & Installation

Pre-built binaries are automatically compiled via GitHub Actions:

### 🍎 macOS (Apple Silicon & Intel)
1. Download the latest **`Vayun-1.0.0-arm64.dmg`** from [**Releases / Actions**](https://github.com/MukulS07/Vayun/actions).
2. Open the `.dmg` file and drag **Vayun** into your **Applications** folder.
3. Launch **Vayun** from Spotlight or Launchpad.

> *Note for macOS:* Because Vayun is independently developed without an expensive Apple Developer ID, if Gatekeeper shows *"Vayun can't be opened"*, simply right-click `Vayun.app` → click **Open**, or go to **System Settings → Privacy & Security** and click **Open Anyway**.

### 🪟 Windows (x64)
1. Download **`Vayun-Setup-1.0.0.exe`** from [**Releases / Actions**](https://github.com/MukulS07/Vayun/actions).
2. Run the installer to add Vayun to your Start Menu and Desktop.

---

## 📅 Google Calendar

Open **Calendar** in the sidebar and click **Sign in with Google**. Approve access in your browser and your Google events appear next to your workspace events — create, edit and delete them right from Vayun. **Sign out** on the Calendar page disconnects it.

Vayun syncs your primary calendar. The sign-in token is encrypted with the OS keychain (Electron `safeStorage`) and stays on your computer.

<details>
<summary>For maintainers: the bundled Google OAuth client</summary>

Calendar sign-in uses Vayun's own OAuth client, set once in `desktop/gcal-logic.js` (`DEFAULT_GCAL_CLIENT`). To create it, in the Google Cloud project behind Vayun (`vayun-12d1b`): enable the **Google Calendar API**, set up the OAuth consent screen with the `calendar.events` scope, then **Credentials → Create credentials → OAuth client ID → Desktop app**, and paste the client ID and secret into `DEFAULT_GCAL_CLIENT`. A desktop client secret is not confidential, so shipping it in the app is expected. Until the consent screen is verified by Google, only listed test users can sign in. For local testing you can override it with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `desktop/.env.local`.
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

---

## 🛡️ Privacy & Architecture

Vayun operates entirely on a local-first paradigm:
- **Zero telemetry or tracking.**
- Data is stored locally in your OS application support directory (`%APPDATA%/Pages` on Windows, `~/Library/Application Support/Pages` on macOS).
- Database structures and markdown content use atomic file operations to prevent file corruption during crashes or abrupt system shutdowns.

---

## 👤 Author

Developed by **Mukul Sharma** ([@MukulS07](https://github.com/MukulS07))  
GitHub: [https://github.com/MukulS07/Vayun](https://github.com/MukulS07/Vayun)
