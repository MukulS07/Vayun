# 002 — Fix press feedback: stronger scale and smooth release

- **Status**: DONE (applied, not yet feel-checked in the app)
- **Commit**: 4fb3deb (working tree already had uncommitted changes when this was written; re-check line numbers)
- **Severity**: MEDIUM
- **Category**: Easing & duration / Physicality
- **Estimated scope**: 1 file (`desktop/app/style.css`), 4 small edits

## Problem

Every button, sidebar item, tree link and calendar cell shares one press rule. It is too subtle (`scale(.99)` is barely visible; the target range is 0.95-0.98) and the transition is declared only inside the `:active` state, so pressing animates but releasing snaps back instantly because the base rule has no transform transition.

```css
/* desktop/app/style.css:521-524 — current */
button:active:not(:disabled), .side-item:active, #tree a:active, .cal-cell:active {
  transform: scale(0.99);
  transition: transform .08s ease;
}
```

Base rules for the same elements:

```css
/* style.css:9 — current */
button { background:none; border:0; cursor:pointer; border-radius:6px; }
/* style.css:35 — current (end of the rule) */
.side-item, #tree a { ...; text-decoration:none; transition:background .12s, color .12s; }
/* style.css:156 — current */
.cal-cell { background:var(--bg); min-height:96px; padding:4px 5px 6px; display:flex; flex-direction:column; gap:2px; cursor:pointer; min-width:0; }
```

The Google sign-in button has its own copy with a 50ms transform:

```css
/* style.css:635 — current */
  transition: background 0.12s, transform 0.05s;
/* style.css:638 — current */
.auth-btn-google:active:not(:disabled) { transform: scale(0.98); }
```

## Target

Press scales to `0.97`; press and release both use `transform 160ms ease-out`, set on the base rules so the release animates too.

```css
/* target */
button { background:none; border:0; cursor:pointer; border-radius:6px; transition:transform 160ms ease-out; }
.side-item, #tree a { ...; text-decoration:none; transition:background .12s, color .12s, transform 160ms ease-out; }
.cal-cell { ...; cursor:pointer; min-width:0; transition:transform 160ms ease-out; }

button:active:not(:disabled), .side-item:active, #tree a:active, .cal-cell:active {
  transform: scale(0.97);
}

/* auth button */
  transition: background 0.12s, transform 160ms ease-out;
.auth-btn-google:active:not(:disabled) { transform: scale(0.97); }
```

## Repo conventions to follow

- Short colour transitions in this file use `.12s` and plain `ease`; keep those as they are. Only the transform timing changes.
- `.cal-swatch` (`style.css:184`) already pairs `transition:transform .12s, box-shadow .12s` with a transform hover; leave it alone.
- `desktop/app` is the source of truth; `android-app/.../www/` and `web-app/dist/` are generated copies.

## Steps

1. `style.css:9`: append `transition:transform 160ms ease-out;` to the `button { ... }` rule.
2. `style.css:35`: change the end of the rule from `transition:background .12s, color .12s;` to `transition:background .12s, color .12s, transform 160ms ease-out;`.
3. `style.css:156`: append `transition:transform 160ms ease-out;` to the `.cal-cell { ... }` rule.
4. `style.css:521-524`: change to `transform: scale(0.97);` and delete the `transition: transform .08s ease;` line.
5. `style.css:635`: change `transition: background 0.12s, transform 0.05s;` to `transition: background 0.12s, transform 160ms ease-out;`; `style.css:638`: change `scale(0.98)` to `scale(0.97)`.
6. List buttons that set their own `transition:` shorthand without `transform` (they would still snap back on release): `grep -nE "transition" desktop/app/style.css`. For each rule whose selector matches a `<button>`-based class and that lacks `transform`, append `, transform 160ms ease-out`. Known ones to check: `.block-add` (style.css:85, opacity only). Report any you skip.

## Boundaries

- Do NOT change `android-app/android-mobile.css` (it has its own `:active` rules at lines 90-97 and `!important` transitions).
- Do NOT change colour/background hover transitions.
- Do NOT add dependencies or change markup.
- If a line does not match the excerpts above, STOP and report.

## Verification

- **Mechanical**: `grep -n "scale(0.99)" desktop/app/style.css` returns nothing; `grep -n "transform .08s" desktop/app/style.css` returns nothing.
- **Feel check**: run the app, press and hold a sidebar item, a toolbar button and a calendar cell.
  - The element visibly shrinks (about 3%) when pressed.
  - On release it eases back instead of snapping.
  - Rapid clicking never leaves the element stuck small.
  - DevTools Animations at 10%: press and release curves are both visible.
- **Done when**: press scales to 0.97 and release is animated on buttons, sidebar items, tree links, calendar cells and the Google sign-in button.
