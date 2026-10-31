# 003 — Add reduced-motion handling and limit moving hovers to real pointers

- **Status**: DONE (applied, not yet feel-checked in the app)
- **Commit**: 4fb3deb (working tree already had uncommitted changes when this was written; re-check line numbers)
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 2 files (`desktop/app/style.css`, `desktop/app/templates/templates.css`), ~20 lines

## Problem

1. The dialog/menu animation and the press scale move things but have no `prefers-reduced-motion` handling. Only `.home-toast` has one.

```css
/* desktop/app/style.css:330 — the only existing handling */
@media (prefers-reduced-motion: reduce) { .home-toast { animation:none; } }
```

2. Two hover rules move elements, and the same CSS ships to Android where a tap triggers hover and leaves it stuck. (Most other `:hover` rules only change colours, which is harmless, so they are out of scope.)

```css
/* desktop/app/style.css:185 — current */
.cal-swatch:hover { transform:scale(1.1); }
/* desktop/app/templates/templates.css:263 — current */
.st-course:hover, .st-tile-card:hover { border-color: var(--line); transform: translateY(-1px); }
```

## Target

Reduced motion keeps a plain fade and drops movement; moving hovers apply only on devices with a real hover pointer.

```css
/* target — add to desktop/app/style.css after the vayun-fade-in keyframes (plan 001 adds vayun-backdrop-in there too) */
@keyframes vayun-fade-in-reduced {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .panel, .form, .settings, .menu {
    animation: vayun-fade-in-reduced .16s ease-out both;
  }
  button:active:not(:disabled), .side-item:active, #tree a:active, .cal-cell:active {
    transform: none;
  }
}

/* style.css:185 */
@media (hover: hover) and (pointer: fine) {
  .cal-swatch:hover { transform:scale(1.1); }
}

/* templates.css:263 — keep border-color unconditional, gate only the movement */
.st-course:hover, .st-tile-card:hover { border-color: var(--line); }
@media (hover: hover) and (pointer: fine) {
  .st-course:hover, .st-tile-card:hover { transform: translateY(-1px); }
}
```

## Repo conventions to follow

- Reduced-motion blocks sit next to the rule they modify, as at `style.css:329-330` and `web/src/styles.css:193`.
- `desktop/app` is the source of truth; generated copies in `android-app/.../www/` and `web-app/dist/` must not be edited by hand.

## Steps

1. In `desktop/app/style.css`, directly after the `@keyframes vayun-fade-in` block (around line 535-538), add the keyframes and `@media (prefers-reduced-motion: reduce)` block from the target. If plan 001 has not been applied, the selector list there still works (it only names `.panel, .form, .settings, .menu`).
2. Replace line 185 with the gated version.
3. In `desktop/app/templates/templates.css`, replace line 263 with the two-rule version (border-color stays on plain hover).
4. Do not touch the colour-only `:hover` rules.

## Boundaries

- Do NOT remove colour or opacity feedback under reduced motion.
- Do NOT change `android-app/android-mobile.css`.
- Do NOT add dependencies or change markup.
- If a line does not match the excerpts, STOP and report.

## Verification

- **Mechanical**: `grep -n "prefers-reduced-motion" desktop/app/style.css` shows the new block next to the existing toast one.
- **Feel check**:
  - DevTools > Rendering > Emulate `prefers-reduced-motion: reduce`: open Settings and the `•••` menu; they fade without sliding or scaling; pressing a button no longer shrinks it.
  - Switch to normal: everything behaves as before.
  - In DevTools device mode with touch, tap a calendar swatch and a template course card: they do not stay enlarged or lifted.
- **Done when**: reduced-motion removes all movement but keeps fades, and the two moving hovers only run with a fine pointer.
