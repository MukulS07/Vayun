# 001 — Remove open animation from the search palette, quick search and slash menu

- **Status**: DONE (applied, not yet feel-checked in the app)
- **Commit**: 4fb3deb (working tree already had uncommitted changes when this was written; re-check line numbers)
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 1 file (`desktop/app/style.css`), ~6 lines

## Problem

Three keyboard-driven surfaces play the shared `vayun-fade-in` animation every time they appear:

- The search palette (`#backdrop` > `.panel`), toggled by Ctrl+K / Ctrl+P (`desktop/app/app.js:1335`, `toggleSearch` at `app.js:1331`). `.backdrop` is `display:none` until `.visible`, so the animation restarts on every open.
- The quick-search window (`desktop/app/quick.html:10`, `<div class="panel" ...>`), opened by a global hotkey; it loads `style.css`.
- The `/` block menu (`.slash-menu`, created at `desktop/app/app.js:581`).

These are opened many times a day from the keyboard. Animation on them only adds delay between keypress and result. In addition, the shared rule also animates `.backdrop` itself, so the full-screen dim layer translates 6px and scales to 0.98 while the panel inside does the same, which is a double transform.

```css
/* desktop/app/style.css:531-538 — current */
.backdrop, .panel, .form, .settings, .menu, .slash-menu {
  animation: vayun-fade-in .16s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes vayun-fade-in {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
```

Other users of `.backdrop` / `.panel` / `.form` / `.settings` are occasional dialogs (settings, auth modal, calendar forms, the prompt dialog built at `app.js:1345`). They keep their animation.

## Target

Palette, quick search and slash menu appear instantly. The dim layer of the remaining dialogs fades only (no movement). Panels, forms, settings and `.menu` keep the existing animation.

```css
/* target — replaces desktop/app/style.css:531-533 */
.panel, .form, .settings, .menu {
  animation: vayun-fade-in .16s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.backdrop {
  animation: vayun-backdrop-in .16s ease-out both;
}
/* Keyboard-opened surfaces: no animation (used many times a day). */
#backdrop, #backdrop .panel, .panel[aria-label="Quick Search"], .slash-menu {
  animation: none;
}

@keyframes vayun-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

(`vayun-fade-in` keyframes stay exactly as they are.)

## Repo conventions to follow

- Motion lives in `desktop/app/style.css` near line 531; this repo has no motion tokens yet (see plan 006 if it exists later). Keep the existing easing `cubic-bezier(0.16, 1, 0.3, 1)` for `vayun-fade-in`.
- Exemplar of a correctly scoped rule: `@media (prefers-reduced-motion: reduce) { .home-toast { animation:none; } }` at `style.css:330`.
- `desktop/app` is the source of truth. `android-app/app/src/main/assets/www/` and `web-app/dist/` are generated copies; do not edit them by hand.

## Steps

1. In `desktop/app/style.css`, replace the selector list and rule at lines 531-533 with the "target" block above (keep the existing `@keyframes vayun-fade-in` block unchanged and add `@keyframes vayun-backdrop-in` after it).
2. Confirm nothing else relies on `.backdrop` having a transform animation: `grep -n "backdrop" desktop/app/*.js` (the dialogs only add/remove classes).
3. Rebuild generated copies only if the project's normal workflow requires it (`android-app/build.js`, `web-app/build.js`); do not hand-edit them.

## Boundaries

- Do NOT touch `desktop/app/templates/templates.css` or `android-app/android-mobile.css`.
- Do NOT change the `@keyframes vayun-fade-in` values or the dialogs that keep it (settings, forms, auth, calendar, prompt).
- Do NOT change markup or JS.
- Do NOT add dependencies.
- If `#backdrop`, the quick-search markup or `.slash-menu` no longer match what is described here, STOP and report.

## Verification

- **Mechanical**: no build or test command covers CSS. Run `grep -n "animation" desktop/app/style.css` and confirm the new rules are present and the palette/slash selectors have `animation: none`.
- **Feel check**: run the desktop app.
  - Press Ctrl+K repeatedly: the palette appears and disappears instantly, no fade or slide.
  - Type `/` in a block: the menu appears instantly.
  - Open Settings and a calendar event form: the panel still fades up 6px; the dim layer only fades (it no longer slides or scales).
  - In DevTools Animations panel at 10% speed, confirm the settings overlay does not move.
- **Done when**: the three keyboard surfaces have no animation and the other dialogs animate as before, except the dim layer now fades only.
