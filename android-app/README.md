# 🍃 Vayun for Android

> **Fast, local-first workspace for notes, planners, and teams on Android.**  
> 100% private, offline-ready, and matching the minimalist design of the desktop software.

---

## 📱 Overview & Architecture

Vayun for Android shares the same core screen codebase (`desktop/app/`) as the desktop and web editions. When you edit code in `desktop/app/` or run `node android-app/build.js`, your screens, styles, and team logic synchronize directly into the Android native package (`app/src/main/assets/www`).

---

## 🗓️ The 4 Implementation Phases

### Phase 1: Architecture, Project Scaffolding & Security Hardening
- **Native Android Project**: Standard Gradle project (`app/`) targeting Android 14 (API 34) with minSdk 24.
- **Least-Privilege Security**:
  - `AndroidManifest.xml` only requests `INTERNET`, `ACCESS_NETWORK_STATE`, and `VIBRATE`.
  - `network_security_config.xml` strictly bans all cleartext HTTP traffic and locks connections to HTTPS endpoints (`*.firebaseio.com`, `*.googleapis.com`).
  - Native `WebView` is hardened: safe browsing enabled, file URL cross-access disabled, and strict Content Security Policy (`CSP`) enforced.
- **Automated Asset Compiler**: `build.js` patches HTML entry points with Android-safe viewports and shims.

### Phase 2: UI/UX Parity with Desktop Software (✅ Completed)
- **Exact Design Tokens**: Uses identical `tokens.css`, `themes-data.js`, and `theme.js` from desktop software (`--bg: #161616`, `--accent: #2FB39A`, `--panel: #1E1E1E`).
- **Mobile Bottom Navigation Bar**:
  - 🏠 **Home**: Quick navigation to daily tasks, overdue items, and pinned notes.
  - 📅 **Calendar**: Month & week views with Google Calendar sync.
  - ➕ **New (FAB)**: Floating action button to instantly create a new block-based note.
  - 🔍 **Search**: Global quick search.
  - ☰ **Menu**: Pulls open the full workspaces, teams, templates, and favorites drawer.
- **Safe-Area Insets & Dynamic Status Bar**:
  - Top notches, dynamic islands, and bottom gesture bars are fully accommodated via CSS safe areas (`env(safe-area-inset-top)` / `env(safe-area-inset-bottom)`).
  - Status bar and navigation bar continuously synchronize colors with the active theme background.
- **Touch Gestures & Keyboard UX**:
  - Edge swipe right to open the navigation drawer; swipe left to dismiss.
  - Auto-hides the bottom navigation bar when typing in the block editor to give maximum vertical screen height.
  - All interactive buttons meet the $44\times 44\text{px}$ minimum mobile touch target standard.

### Phase 3: Offline-First Engine & Native Android Bridge (✅ Completed)
- **Local-First Storage**: Powered by IndexedDB (`android-api.js`), pages and workspaces are kept 100% offline on the phone, never needing an internet connection for personal notes.
  - Fail-safe fallback to `localStorage` and in-memory cache if private browsing restricts IndexedDB.
  - Lifecycle persistence: debounced flush on both `visibilitychange` (app switch) and `pagehide`.
  - Workspace Backup: Export full workspace to standalone portable `.json` backup file from the navigation drawer.
  - Native File Import: Select and import HTML, Markdown, and TXT files directly into notes using Android's native file chooser.
- **Native Bridge (`window.VayunAndroid` & `WebAppInterface.kt`)**:
  - **Haptic Touch Feedback**: Tactile vibration pulses on task checkmark toggles, FAB taps, navigation bar buttons, and calendar swatches.
  - **System Back Dispatcher**: Pressing Android's back button or swipe gesture closes active drawers, dismisses modal dialogs, and returns to Home before exiting.
  - **Native Android Share Sheet**: Topbar `#share-btn` triggers Android's `ACTION_SEND` chooser to share notes to WhatsApp, Gmail, Keep, Drive, etc.
  - **Clipboard & Connectivity**: Native clipboard copy and network availability detection.

### Phase 4: Cloud Sync, Auth & Teams Verification (✅ Completed)
- **Cloud Firestore**: Team tasks and team calendar events sync in real-time using Firestore REST API with strict [`firestore.rules`](../firestore.rules).
- **Firebase Auth & Google Sign-In**:
  - Scoped to Identity Toolkit and Token Service.
  - Native multi-window popup handler (`WebChromeClient.onCreateWindow`) with clean Mobile Chrome User Agent so Google OAuth succeeds in Android WebView without embedded restrictions.
  - Active auth state reflected in slide-over drawer (`#side-auth-mount`) and inline on Team & Calendar pages.
  - Google Calendar two-way synchronization via scoped OAuth credentials.

---

## 🛠️ Step-by-Step Guide: How to Use

### 1. Live Mobile Preview inside the IDE (Live Editing)
To edit and see changes live inside the IDE without opening an emulator:

1. Start the local preview server:
   ```bash
   node android-app/build.js
   npx serve android-app/dist -p 8099
   ```
2. Open the Command Palette in the editor (<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd>).
3. Search for **`Mobile Preview: Open`** or **`Phone Preview`**.
4. Enter URL: `http://localhost:8099/start.html`
5. Select **Pixel** or **Galaxy** preset.
6. As you edit files, the simulator will reflect updates live!

### 2. Building and Running in Android Studio

1. Open **Android Studio**.
2. Select **Open** and choose the `android-app` folder (`M:\WEBSITES\Vayun\android-app`).
3. Allow Gradle to sync dependencies (`androidx.webkit`, `material`).
4. Click **Run ▶** to launch on an Android Virtual Device (AVD) or physical device connected via USB.

### 3. Building Debug APK via Command Line

If you have the Android SDK command-line tools configured:
```bash
cd android-app
# Rebuild web assets
node build.js

# Build debug APK using Gradle wrapper
./gradlew assembleDebug

# Install on connected device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

---

## 🔒 Security Checklist

| Check | Status | Verification |
| :--- | :---: | :--- |
| **No Cleartext Traffic** | Passed | Enforced in `network_security_config.xml` (`cleartextTrafficPermitted="false"`). |
| **Least-Privilege Permissions** | Passed | Only `INTERNET`, `ACCESS_NETWORK_STATE`, and `VIBRATE`. |
| **WebView Isolation** | Passed | `allowFileAccessFromFileURLs=false`, `allowUniversalAccessFromFileURLs=false`. |
| **Content Security Policy** | Passed | Script sources restricted to `'self'` and trusted Google/Firebase CDNs. |
| **Team Access Control** | Passed | Enforced in [`firestore.rules`](../firestore.rules); only signed-in team members can read/write team tasks. |
