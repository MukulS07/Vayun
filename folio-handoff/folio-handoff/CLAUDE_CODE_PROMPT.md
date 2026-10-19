# Folio — Life OS & Study OS templates + theme system
## Implementation brief for Claude Code

> **How to use:** put this whole `folio-handoff/` folder in the root of your repo, open Claude Code there, and paste:
>
> ```
> Read folio-handoff/CLAUDE_CODE_PROMPT.md and implement it end to end. Start with Phase 0 and show me the plan before writing code.
> ```

---

## 0. Context

We're building **Folio**, a Notion-style workspace. The design team finished interactive prototypes for:

1. **App shell + theme customizer.** Sidebar, doc page, board view, ⌘K palette, and a Settings → Appearance modal with official themes, workspace (brand) themes, accent, font, density, corner radius and page width.
2. **Life OS template.** A personal dashboard: priorities, task database with Overview + Week views, habits, stats, pomodoro, ambient sounds and time progress.
3. **Study OS template.** A student dashboard: courses, task manager, timetable, academic calendar, wheel of life, pomodoro, mini to-dos, reminders, a clock and a goal tracker.

Both templates ship in **two themes, Dark and Light**. The user can switch at any time, and **every piece of content is user-editable**.

The prototypes are in `folio-handoff/design/` as `.dc.html` files. Each file contains the full markup with inline styles and a `class Component` that holds all the logic and sample data. **Treat them as the source of truth for layout, spacing, copy, colors and behavior.** Do not invent a different look. Exact color tokens are in `folio-handoff/tokens.json`.

| Prototype file | What it is |
|---|---|
| `design/Main.dc.html` | App shell, doc page, board view, ⌘K palette, Appearance settings modal |
| `design/Life.dc.html` | Life OS template (dark + light via `theme` prop) |
| `design/Study.dc.html` | Study OS template (dark + light via `theme` prop) |
| `design/LifeLight.dc.html`, `design/StudyLight.dc.html` | Wrappers that render the templates with `theme="light"`, for reference only |

The `.dc.html` syntax: `{{hole}}` = value from `renderVals()`, `<sc-for list= as=>` = loop, `<sc-if value=>` = conditional, `onClick="{{fn}}"` = handler. Translate these to idiomatic components for our stack.

---

## Phase 0: Inspect before building (required)

1. Detect the stack: framework, language, styling approach, state management, data layer/backend, routing, test setup and package manager. Check `package.json`, configs and existing components.
2. Find any existing equivalents: workspace/page models, sidebar, theme handling, editor, database/table components. **Reuse and extend them rather than duplicating.**
3. Reply with a short plan before writing code:
   - which files you'll add or change;
   - how theme tokens will be wired;
   - where template data will be persisted.

   Wait for approval.

**If the repo is empty or has no frontend yet**, use this default stack:
- Next.js (App Router) + React + TypeScript (strict)
- Tailwind CSS, where all colors come from CSS variables (see §2)
- Zustand with the `persist` middleware for state (localStorage now, with an easy path to an API later)
- `lucide-react` for icons (the prototypes use inline stroke icons in the same style)
- Fonts via `next/font/google`: **Geist**, **Geist Mono** and **Newsreader** (Newsreader is the optional serif page font)
- Vitest + Testing Library for tests

---

## Phase 1: Theme system

### 1.1 Token architecture
- Every color is a **CSS custom property**, and components never hard-code hex values. The only exceptions are the illustrative cover art and the pixel scenes, which are artwork.
- Theme tokens are applied with a `data-theme` attribute plus a `data-template` attribute on the template root (or `<html>` for the app shell). For example:
  ```html
  <div data-template="life" data-theme="dark"> … </div>
  ```
- Token names and values for **all four combos** (Life dark/light and Study dark/light) are in `tokens.json`. Use those names (`--bg`, `--panel`, `--panel-2`, `--card`, `--line`, `--text`, `--muted`, `--accent`, `--accent-ink`, `--amber-bg`, `--amber-fg`, …) so the prototype styles map 1:1.
- The app shell's 8 official themes plus the "Acme Brand" workspace theme are defined in `tokens.json → appThemes`. They use the variables from the Main prototype (`--side`, `--surface`, `--hover`, `--accent-soft`, `--side-text`, …).
- With Tailwind, expose the tokens through `theme.extend.colors`. For example, `bg: 'var(--bg)'` lets you write `bg-bg`, `text-muted`, `border-line` and so on.

### 1.2 Theme behavior
- Each template page has a **Dark / Light segmented switch** in the cover's top-right corner. It's a radiogroup with ☾ and ☀ labels on a translucent dark pill, styled as in the prototype.
- The choice is **saved per page**. Fallback order: page setting → user's app theme mode → `prefers-color-scheme`.
- Theme changes **animate**: `transition: background .25s, color .25s` on the root.
- No flash on load: set `data-theme` before paint, using an inline script or SSR cookie in Next.js.
- The Appearance modal (Main prototype) controls the **app shell** theme:
  - accent override (8 swatches including "Theme default");
  - page font (Default / Serif / Mono);
  - density (Comfortable / Compact → `--row`, `--gap`, `--card-pad`);
  - corners (Sharp / Soft / Round → `--radius`, `--radius-lg`);
  - page width (Default 720px / Full).

  All of these apply live behind the modal, and **Reset** restores the defaults. Include "Life OS" and "Study OS" as the first two official app themes.
- Workspace/brand themes: support a `WorkspaceTheme` record (name plus a token map) that admins can create. The "Create theme" card can open a simple form that has a name and accent/background/sidebar colors and derives the rest. Locking a theme for all members can stay a stub for now; leave a TODO.

---

## Phase 2: Data model

Persist everything per **page instance**, so each user can have several Life OS or Study OS pages.

```ts
type ThemeMode = 'dark' | 'light';

interface TemplatePageBase {
  id: string;
  template: 'life' | 'study';
  title: string;          // editable inline (big heading input)
  subtitle: string;       // editable inline
  theme: ThemeMode;
  createdAt: string; updatedAt: string;
}

// ---------- Life OS ----------
type LifeStatus = 'Not started' | 'To-do' | 'In progress' | 'Done';
type LifePriority = 'Low' | 'Normal' | 'Urgent' | 'Very urgent';
type Difficulty = 'Easy' | 'Normal' | 'Hard' | 'Very hard';

interface LifeTask {
  id: string; name: string;
  status: LifeStatus; priority: LifePriority;
  day: 0|1|2|3|4|5|6|null;   // 0 = Sunday, null = no date
  difficulty: Difficulty; project: string;
}
interface Habit { id: string; name: string; colorIndex: number; days: boolean[] /* last 35 days, index 34 = today */ }
interface LifeOSPage extends TemplatePageBase {
  template: 'life';
  priorities: string[];
  tasks: LifeTask[];
  habits: Habit[];
  pomodoro: { workMin: number; breakMin: number };
  ambientSound: 'rain' | 'forest' | 'cafe' | 'lofi';
}

// ---------- Study OS ----------
type StudyStatus = 'Not started' | 'In progress' | 'Done';
type StudyPriority = 'Low' | 'Medium' | 'High';
interface Course { id: string; name: string; glyph: string; paletteIndex: number; done: number; total: number; nextExam: string }
interface StudyTask { id: string; name: string; courseId: string | null; priority: StudyPriority; status: StudyStatus; day: 0|1|2|3|4|5|6|null /* 0 = Monday */ }
interface StudyOSPage extends TemplatePageBase {
  template: 'study';
  courses: Course[];
  tasks: StudyTask[];
  timetable: (string | 'LUNCH' | '')[][];   // 7 time slots × 5 weekdays, values are courseIds
  wheel: { area: string; value: number }[]; // 6 areas, 1–10
  todos: { id: string; text: string; done: boolean }[];
  reminders: { id: string; date: string; text: string }[];
}
```

- Seed new pages with the **sample data in each prototype's `constructor`**, which reads like a real example. Also offer a **"Start empty"** option when a user creates a page from a template.
- Pomodoro runtime state (time left, running, phase, cycles, sessions today) and clocks are **ephemeral UI state**, not persisted. The exception is "sessions today", which may persist per day.
- Persistence: if a backend or DB exists, add models and API routes following existing conventions. Otherwise use a Zustand `persist` store keyed by page id. Debounce writes to 300 ms.

---

## Phase 3: Life OS (`design/Life.dc.html`)

Build these components and match the prototype pixel-for-pixel:

1. **Cover.**
   - SVG mountain-sunset art. Sky gradient stops and mountain fills come from the tokens (`--sky-0..3`, `--mtn-1/2`), so light mode becomes a pastel dawn.
   - The bottom ridge fills with `--bg` so it blends into the page.
   - A `© {year}` label sits on the left, in mono with wide tracking. The theme switch sits on the right.
2. **Header.** An icon tile, then the **title and subtitle as borderless inputs** that save on change. Below them, an accent-soft hint pill: "Everything here is editable…".
3. **Left nav.** Four groups: Planners, Personal, Accountability, Misc. Items are 44px cards that link to page sections, and some carry blue/green/red tones (light and dark variants are in the prototype).
4. **Widget grid** (`repeat(auto-fit, minmax(300px,1fr))`):
   - **Today card:** weekday, date, a greeting that changes by time of day, an HH:MM clock, an "N tasks open" chip and an "N habits left today" chip.
   - **Ambient sound:** a play/pause button and 4 sound chips. Wire this to real looping audio files if assets exist; otherwise make the UI work and add a TODO.
   - **Time progress:**
     - year % with a ring;
     - month % bar;
     - week pills (Mon–Sun), with today highlighted yellow `#E8C547`;
     - day % bar.

     Everything is computed from the real date and refreshes every minute.
   - **Pomodoro:** a real countdown with Focus and Break phases and 4 cycle bars. Work and break steppers move in ±5 and ±1 minutes. Buttons: Start/Pause, Reset, Skip. Clear the interval on unmount.
5. **Problems & priorities.** An ordered list where each item has an × delete button, plus an input and "Add" (Enter also submits).
6. **Task overview.** This is the same task collection as the week view.
   - **Tabs** with counts: Uncompleted, Due today, Due tomorrow, No date, All. "Due" is derived from `day` relative to the current weekday.
   - **Each row:** a status chip button that cycles status, the name, a due label, a priority chip button that cycles priority, and × delete.
   - **Add form:** name, a Day select ("No date" plus Sun–Sat, with today labelled) and a Priority select.
7. **This week.** A 7-column calendar (Sun–Sat) with real dates and the today number in a red badge.
   - Shows every task that has a `day`.
   - **Cards:** name, a status chip, a difficulty chip and "↳ project". Card background is tinted by status (`--cal-done`, `--cal-prog`, `--cal-todo`, `--cal-none`), and clicking a card cycles its status.
   - The calendar scrolls horizontally below 980px.
8. **Habits.**
   - **Card per habit:** name, current streak in days and × delete.
   - **Grid:** 7×5 day cells, with the habit's color when done and `--track` when not. Today's cell has an outline, and cells are toggle buttons.
   - **"Mark done" button:** becomes "Done today ✓" once today is ticked.
   - **"New habit" card:** an input and an add button.
   - **Colors:** cycle through `#9B7BEA #E8A33D #C98A6A #D9534F #4E8FE8 #D46A9A #2FB39A #7A8F3A`.
9. **Your stats.** An area and line chart of habits completed per day over 35 days. The y-axis max is the number of habits. Show the average per day and a "Best: X / N" chip. It updates live when habits change.

---

## Phase 4: Study OS (`design/Study.dc.html`)

1. **Pixel-art banner and covers.**
   - Port the `scene(W, H, kind, palette, seed)` generator exactly. It's a seeded PRNG that produces a grid of colored cells, with `forest` and `city` kinds.
   - **Palettes:** `grove`, `groveDay`, `teal`, `neon`, `jade`, `dusk`, `harbor`, `rain`.
   - **Memoize per key.** Render the grid with `<canvas>` or CSS grid; canvas is preferred for performance.
   - **Banner:** 72×14 cells, 210px tall. It uses `grove` in dark mode and `groveDay` in light mode.
2. **Header.** An "A+" tile, editable title and subtitle inputs, and the hint pill. The theme switch sits on the banner.
3. **Left rail.**
   - **Analog clock (SVG):** hour, minute and second hands, ticking every second.
   - **Progress boxes:** Year, Month and Week as outlined bars with a `--text` fill.
   - **Quick actions:** anchor links that scroll to and focus the relevant add inputs.
   - **Goal tracker:** Q1–Q4, with the current quarter highlighted and its progress computed from the date.
   - **Nav groups:** Academy life, Personal life and Future plan.
4. **Courses.**
   - Gallery cards show a pixel cover (palette by index), the name with its glyph, and assignments done/total with − and + buttons. They also show a % bar, an "N open tasks" count and the next exam, plus × delete.
   - An "Add course" card has an input; new courses get the next palette.
5. **Section tiles.** Assignments, Timetable, To-dos and Calendar, each with a pixel cover and a live count, linking to its section.
6. **Wheel of life.**
   - **Radar chart:** 6 axes, rings at 25, 50, 75 and 100%.
   - **Sliders:** 6 range sliders from 1–10 under the chart that update it live.
   - **Color:** the fill uses `--radar-fill` and `--radar-stroke`.
7. **Pomodoro.**
   - Pixel-city background with a dark gradient overlay (the same in both themes).
   - Mode pills: Pomodoro 25, Short break 5 and Long break 15.
   - Big 72px time with Start/Pause and Reset. Show "N sessions today", which increments when a pomodoro completes.
8. **Mini to-dos.** Add with an input and Enter, toggle with a checkbox, × delete and an "N left" count.
9. **Reminders & events.** Add with date text and description, × delete.
10. **Task manager.**
    - **Tabs:** This week (tasks with a day, sorted), Undated, and By priority (all tasks, High → Low).
    - **Each row:** checkbox, name (struck through when done), course, a priority chip that cycles on click, a status chip that cycles on click, a date shown as "Wed · Oct 22" from the real current week, and × delete.
    - **Add form:** name, a Course select (all courses plus "Personal"), Day and Priority.
11. **Timetable.**
    - A grid of 7 time slots × Mon–Fri. The 11–12 row is a fixed "Lunch" row.
    - Clicking a slot cycles through empty and then each course.
    - Filled slots get a 3px left bar in the course tint.
12. **Academic calendar.** A Mon–Sun grid for the current week, with today highlighted. It shows tasks that have a day, each with the course and its priority and status chips.

---

## Phase 5: App integration

- **Template picker:** "New page → Templates" shows Life OS and Study OS cards with dark and light previews. Creating a page asks "With sample content / Start empty" and lets the user pick the theme.
- **Sidebar:** template pages appear in the sidebar like any page. Their icon is the template tile.
- **Command palette (⌘K):** add the commands "Toggle light / dark", "Change theme…" and "New Life OS page" / "New Study OS page".
- **App shell (`design/Main.dc.html`):** if it isn't built yet, implement it the same way:
  - the sidebar with Search/⌘K, Home, Inbox (with badge), Calendar, Favorites, Teamspaces, Settings, and a Themes row showing the current theme;
  - a topbar with avatars, Customize, Share and a more menu;
  - the doc page with cover, icon, properties, to-dos and the AI summary callout;
  - the board view;
  - the Appearance modal.

---

## Quality bar (acceptance criteria)

- [ ] Both templates render correctly in **both themes**. Every text/background pair meets **WCAG AA**: 4.5:1 for body text, 3:1 for text 24px and up. The light tokens in `tokens.json` were chosen for this; check any new ones.
- [ ] Every add, edit, delete and cycle action persists across reload.
- [ ] Theme choice persists per page, with no flash of the wrong theme on load.
- [ ] Fully keyboard accessible:
  - real `<button>`, `<input>`, `<select>` and `<label>` elements;
  - `aria-label` on icon-only buttons (×, −, +, play);
  - `role="radiogroup"`/`radio` for segmented controls;
  - `role="tablist"`/`tab` for tabs;
  - visible focus rings.
- [ ] Touch targets are at least 32px (44px for primary controls).
- [ ] Responsive layout:
  - the left nav or rail stacks above the content below about 860px;
  - the calendars, timetable and task table scroll horizontally inside their own box;
  - no horizontal page scroll at 375px.
- [ ] Timers use one interval per page, are cleaned up on unmount and pause when the tab is hidden.
- [ ] No emoji in the UI. Icons are the glyphs from the prototype or lucide icons.
- [ ] Unit tests for:
  - due-date derivation;
  - status and priority cycling;
  - habit streak calculation;
  - pomodoro phase transitions;
  - the pixel scene generator (deterministic for the same seed);
  - the theme fallback order.
- [ ] Run lint, typecheck and tests, and fix everything before calling it done.

## Working rules

- Build in this order: Phase 0 → 1 → 2 → 3 → 4 → 5. Commit after each phase with a clear message.
- Keep components small: one file per widget or section, with shared `Chip`, `SegmentedControl`, `SectionHeader`, `InlineInput` and `DeleteButton` primitives.
- Copy the copy, spacing, radii and font sizes from the prototypes; don't approximate them.
- If something in the prototype conflicts with the existing codebase's conventions, follow the codebase and note the deviation in your summary.
- At the end, summarize what was built, how to run it, any TODOs (audio assets, brand-theme locking) and screenshots or routes to check.
