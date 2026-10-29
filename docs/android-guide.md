# Android App Guide

This guide covers everything needed to build, live-preview, and ship the **Vayun Android application**.

---

## 4-Phase Roadmap

### Phase 1: Native Architecture & Security Hardening
- **Native Shell**: Android application located in [`android-app/`](../android-app/).
- **Security Posture**:
  - `network_security_config.xml` blocks all cleartext HTTP traffic.
  - Hardened WebView configuration with Google Safe Browsing and origin isolation.
  - Strict Content-Security-Policy (CSP) disallowing untrusted third-party scripts.
  - Zero arbitrary storage permissions: all user data resides strictly within Android's private app sandbox.

### Phase 2: UI & UX Design Parity with Desktop
- **Shared Design Tokens**: Reuses `tokens.css`, `themes-data.js`, and `theme.js` from `desktop/app/`.
- **Theme Synchronization**: The status bar and navigation bar adapt dynamically to match the current theme background.
- **Mobile Touch Accommodations**:
  - 44px+ touch targets on all interactive elements.
  - Safe-area insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`) for camera notches and gesture navigation.
  - Responsive slide-over navigation drawer with backdrop dismissal.

### Phase 3: Local-First Storage & Offline Engine (✅ Completed)
- **Client Bridge (`android-api.js`)**: Matches Electron's `window.api` using IndexedDB for local-first, zero-cloud storage with automatic localStorage fallback and lifecycle debounced flushing.
- **Android Native Features (`WebAppInterface.kt`)**:
  - Haptic touch feedback on task checkboxes, navigation tabs, and calendar swatches.
  - System back button / swipe gesture interceptor (closes drawers, backdrops, and dialogs before navigating or exiting).
  - Native Android share sheet (`Intent.ACTION_SEND`) via topbar `#share-btn`.
  - Native file chooser via `WebChromeClient.onShowFileChooser` for importing HTML/Markdown notes.
  - Offline workspace backup export to portable `.json`.

### Phase 4: Cloud Sync & Operational Setup (✅ Completed)
- **Cloud Firestore**: Team sync for tasks and events using [`firestore.rules`](../firestore.rules).
- **Google Sign-In & Multi-Window OAuth**:
  - Scoped Firebase Authentication with Google Sign-In.
  - Multi-window handler (`onCreateWindow`) in native `MainActivity.kt` with clean Mobile Chrome User Agent for smooth OAuth flows.
  - Auth profile pill in drawer and direct sign-in triggers on Team and Calendar pages.

---

## Live Mobile Preview in Editor

1. Run the build & start the local dev server:
   ```bash
   node android-app/build.js
   npx serve android-app/dist -p 8099
   ```
2. Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> in your editor.
3. Type **`Mobile Preview: Open`** and press <kbd>Enter</kbd>.
4. URL: `http://localhost:8099/start.html`
5. Select a mobile device frame to live-edit your screens.

---

## Building the Native APK

1. **In Android Studio**: Open the `android-app/` directory and click **Run ▶**.
2. **Via CLI**:
   ```bash
   cd android-app
   node build.js
   ./gradlew assembleDebug
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

