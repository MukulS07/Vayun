# 004 — Make the page-actions menu grow from its button

- **Status**: DONE (applied, not yet feel-checked in the app)
- **Commit**: 4fb3deb (working tree already had uncommitted changes when this was written; re-check line numbers)
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 file (`desktop/app/style.css`), 1 line

## Problem

The `•••` page-actions menu is anchored under its button at the top-right (`right:0; top:calc(100% + 6px)`) but, with no `transform-origin`, the shared open animation (`translateY(6px) scale(0.98)`) scales it from its centre. Popovers should scale from the trigger. Modals are exempt and stay centred.

```css
/* desktop/app/style.css:66 — current */
.menu { position:absolute; right:0; top:calc(100% + 6px); z-index:50; min-width:200px; display:flex; flex-direction:column; padding:6px; background:var(--card); border:1px solid var(--line); border-radius:10px; box-shadow:0 12px 32px var(--shadow, rgba(0,0,0,.35)); }
```

The menu is toggled via the `hidden` attribute in `desktop/app/app.js:395-408` (`setOpen`), so the animation replays on each open.

## Target

```css
/* target — same rule, one property added */
.menu { position:absolute; right:0; top:calc(100% + 6px); transform-origin:top right; z-index:50; min-width:200px; ... }
```

Only `transform-origin: top right` is added; everything else on the line is unchanged.

## Repo conventions to follow

- Menu placement/animation CSS lives in `desktop/app/style.css`. Generated copies in `android-app/.../www/` and `web-app/dist/` must not be hand-edited.

## Steps

1. In `desktop/app/style.css` line 66, insert `transform-origin:top right;` after `top:calc(100% + 6px);`.

## Boundaries

- Do NOT change `.backdrop`, `.panel`, `.form` or `.settings` origins (modals stay centred).
- Do NOT touch `.slash-menu` (its animation is removed by plan 001).
- Do NOT change the keyframes, markup or JS.
- If line 66 does not match, STOP and report.

## Verification

- **Mechanical**: `grep -n "transform-origin:top right" desktop/app/style.css` finds the rule.
- **Feel check**: open the `•••` menu in the app. At 10% speed in DevTools Animations, the menu should grow and settle from the top-right corner under the button, not from its middle.
- **Done when**: the menu visibly anchors to its button while opening.
