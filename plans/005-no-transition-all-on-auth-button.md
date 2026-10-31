# 005 — Replace `transition: all` on the secondary auth button

- **Status**: DONE (applied, not yet feel-checked in the app)
- **Commit**: 4fb3deb (working tree already had uncommitted changes when this was written; re-check line numbers)
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 1 file (`desktop/app/style.css`), 1 line

## Problem

`transition: all` animates every property that changes, including ones nobody intended, and can pull layout or paint properties into the transition. It is the only `all` in the app CSS.

```css
/* desktop/app/style.css:664-675 — current */
.auth-btn-secondary {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--muted);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.12s;
}
.auth-btn-secondary:hover { background: var(--hover); color: var(--fg); }
```

The only properties that change on interaction are `background` and `color`.

## Target

```css
/* target */
  transition: background 0.12s, color 0.12s;
```

## Repo conventions to follow

- Other colour transitions in this file use the same form and timing, for example `transition:background .12s, color .12s;` at `style.css:35`.
- If plan 002 has been applied, `button` has a base `transition:transform 160ms ease-out`; this rule sets its own shorthand, so add `, transform 160ms ease-out` to keep press release smooth: `transition: background 0.12s, color 0.12s, transform 160ms ease-out;`. If plan 002 is not applied, use the plain target above.

## Steps

1. In `desktop/app/style.css` (line 673), replace `transition: all 0.12s;` with the target value above.
2. Verify no other `transition: all` exists: `grep -rn "transition: *all" desktop/app/style.css desktop/app/templates/templates.css`.

## Boundaries

- Do NOT change the button's colours, padding or markup.
- Do NOT edit generated copies in `android-app/.../www/` or `web-app/dist/`.
- Note: `android-app/android-mobile.css` lines using `!important` transitions are out of scope.
- If line 673 does not match, STOP and report.

## Verification

- **Mechanical**: the `grep` in step 2 returns no results in `desktop/app/style.css`.
- **Feel check**: open the sidebar user area; hovering the secondary auth button changes its background and text colour smoothly in about 120ms, with no other property animating.
- **Done when**: `transition: all` is gone from the app CSS and hover looks unchanged.
