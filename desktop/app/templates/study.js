// Study OS template. Structure and copy follow design/Study.dc.html; logic lives in template-logic.js.
// Persisted: page.title, page.subtitle, page.theme, page.state (courses, tasks, timetable, wheel, todos,
// reminders, sessionsToday). Ephemeral: timer, mode, the task tab, the clock, drafts.
(function () {
  const { h, chip, segmented, deleteButton } = FolioUI;
  const L = FolioTemplates;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const SLOTS = ['8:00 – 9:00', '9:00 – 10:00', '10:00 – 11:00', '11:00 – 12:00', '12:00 – 1:00', '1:00 – 2:00', '2:00 – 3:00'];
  const TT_HEAD = ['Time', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const TABS = [['week', 'This week'], ['undated', 'Undated'], ['priority', 'By priority']];
  const MODES = [['pomo', 'Pomodoro', 25 * 60], ['short', 'Short break', 5 * 60], ['long', 'Long break', 15 * 60]];
  const STATUS_TONE = { 'Not started': 'gray', 'In progress': 'amber', Done: 'green' };
  const PRIO_TONE = { High: 'red', Medium: 'amber', Low: 'blue' };
  const TINT = ['#E0A243', '#E07A8C', '#3FB394', '#A57DE8', '#5B95F0', '#5FA6B8'];
  const PALETTES = L.SCENE_PALETTES.filter(p => p !== 'groveDay');
  const pad = n => (n < 10 ? '0' : '') + n;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const todayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sceneCache = new Map();

  // Pixel art: colours from the seeded generator, drawn to a canvas (cached per key).
  function pixelCanvas(W, H, kind, palette, seed, cssClass) {
    const key = [W, H, kind, palette, seed].join('|');
    let cells = sceneCache.get(key);
    if (!cells) { cells = L.scene(W, H, kind, palette, seed); sceneCache.set(key, cells); }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.className = cssClass || 'st-pixel';
    c.setAttribute('aria-hidden', 'true');
    const ctx = c.getContext('2d');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { ctx.fillStyle = cells[y * W + x]; ctx.fillRect(x, y, 1, 1); }
    return c;
  }

  function mount(container, page, opts) {
    const S = () => page.state;
    const ui = {
      tab: 'week', mode: 'pomo', left: 25 * 60, running: false, now: Date.now(),
      courseDraft: '', todoDraft: '', remDate: '', remText: '', taskDraft: '', taskCourse: S().courses[0] ? S().courses[0].id : 'none', taskDay: 'none', taskPrio: 'Medium',
    };
    let refs = {};
    let timer = null;
    let theme = page.theme || opts.resolvedTheme;
    const change = () => opts.onChange();

    const sessionsToday = () => (S().sessionsToday.date === todayKey(new Date(ui.now)) ? S().sessionsToday.count : 0);
    const curMode = () => MODES.find(m => m[0] === ui.mode);

    // ---------- live values, updated every second ----------
    function updateLive() {
      const now = new Date(ui.now);
      const set = (k, text) => { if (refs[k]) refs[k].textContent = text; };
      const hh = now.getHours(), mm = now.getMinutes(), ss = now.getSeconds();
      set('clockDigital', `${pad(hh)}:${pad(mm)}:${pad(ss)}`);
      if (refs.hour) refs.hour.setAttribute('transform', `rotate(${(hh % 12) * 30 + mm * 0.5} 60 60)`);
      if (refs.min) refs.min.setAttribute('transform', `rotate(${mm * 6 + ss * 0.1} 60 60)`);
      if (refs.sec) refs.sec.setAttribute('transform', `rotate(${ss * 6} 60 60)`);
      set('pomoTime', `${pad(Math.floor(ui.left / 60))}:${pad(ui.left % 60)}`);
      set('sessions', `${sessionsToday()} sessions today`);
      if (refs.pomoBtn) refs.pomoBtn.textContent = ui.running ? 'Pause' : (ui.left === 0 ? 'Done ✓' : 'Start');
    }

    function startTimer() { if (!timer && !document.hidden) timer = setInterval(tick, 1000); }
    function stopTimer() { clearInterval(timer); timer = null; }
    function tick() {
      ui.now = Date.now();
      if (ui.running) {
        const before = ui.left;
        const next = L.studyTick({ mode: ui.mode, left: ui.left, running: true, sessions: 0 });
        ui.left = next.left;
        ui.running = next.running;
        if (before > 0 && next.left === 0 && ui.mode === 'pomo') {
          const today = todayKey(new Date(ui.now));
          const count = S().sessionsToday.date === today ? S().sessionsToday.count : 0;
          S().sessionsToday = { date: today, count: count + 1 };
          change();
        }
      }
      updateLive();
    }
    const onVisibility = () => { if (document.hidden) stopTimer(); else { startTimer(); tick(); } };
    document.addEventListener('visibilitychange', onVisibility);

    // ---------- SVG helpers ----------
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = (tag, attrs) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
      return el;
    };

    function skyline(W, H, kind, palette, seed) { return pixelCanvas(W, H, kind, palette, seed, 'st-pixel'); }

    // ---------- sections ----------
    function banner(d) {
      const bannerCanvas = pixelCanvas(72, 14, 'forest', theme === 'dark' ? 'grove' : 'groveDay', 7, 'st-banner-art');
      return h('div', { class: 'st-banner' }, bannerCanvas,
        h('div', { class: 'st-banner-theme' }, segmented('Theme', [{ value: 'dark', label: '☾ Dark' }, { value: 'light', label: '☀ Light' }], theme, pickTheme)));
    }

    function header() {
      return h('div', { class: 'st-head' },
        h('div', { class: 'st-tile', 'aria-hidden': 'true' }, 'A+'),
        h('label', { for: 'study-title', class: 'sr-only' }, 'Page title'),
        h('input', { id: 'study-title', class: 'st-title-input', value: page.title, onchange: e => { page.title = e.target.value.trim() || 'Study OS'; change(); } }),
        h('label', { for: 'study-sub', class: 'sr-only' }, 'Page description'),
        h('input', { id: 'study-sub', class: 'st-sub-input', value: page.subtitle, onchange: e => { page.subtitle = e.target.value; change(); } }),
        h('p', { class: 'st-hint' }, 'Make it yours — add courses and tasks, edit the timetable, tick things off. Everything updates live.'));
    }

    function rail(d) {
      const now = new Date(ui.now);
      const y = now.getFullYear();
      const yearPct = Math.floor((now - new Date(y, 0, 1)) / (new Date(y + 1, 0, 1) - new Date(y, 0, 1)) * 100);
      const dim = new Date(y, now.getMonth() + 1, 0).getDate();
      const monthPct = Math.floor((now.getDate() - 1 + now.getHours() / 24) / dim * 100);
      const weekPct = Math.floor((((now.getDay() + 6) % 7) + now.getHours() / 24) / 7 * 100);
      const progress = [['Year', yearPct], ['Month', monthPct], ['Week', weekPct]];
      const qNow = Math.floor(now.getMonth() / 3);
      const quarters = ['Q1 · Jan – Mar', 'Q2 · Apr – Jun', 'Q3 · Jul – Sep', 'Q4 · Oct – Dec'].map((name, i) => {
        const pct = i < qNow ? 100 : i === qNow ? Math.max(5, Math.floor(((now.getMonth() % 3) + now.getDate() / dim) / 3 * 100)) : 0;
        const cur = i === qNow;
        return h('div', { class: `st-quarter${cur ? ' current' : ''}` },
          h('div', { class: 'st-row-between small' }, h('span', { class: 'strong' }, name), h('span', { class: 'st-muted tiny' }, cur ? 'Current' : (i < qNow ? 'Closed' : 'Upcoming'))),
          h('div', { class: 'st-bar-row' }, h('span', { class: 'st-mono tiny st-muted' }, `${pct}%`), h('div', { class: 'st-thin' }, h('div', { class: `st-thin-fill${cur ? ' accent' : ''}`, style: `width: ${pct}%` }))));
      });
      const quick = [['+', 'New task', 'st-task-new'], ['▤', 'New course', 'st-course-new'], ['✓', 'New to-do', 'st-todo-new'], ['⚑', 'New reminder', 'st-rem-date'], ['▦', 'Edit timetable', 'timetable']];
      const rails = [
        ['Academy life', [['☰', 'Task manager', 'tasks'], ['▤', 'Courses', 'courses'], ['▦', 'Timetable', 'timetable'], ['◷', 'Academic calendar', 'calendar']]],
        ['Personal life', [['◎', 'Wheel of life', 'wheel'], ['✓', 'Mini to-dos', 'todos'], ['⚑', 'Reminders', 'reminders']]],
        ['Future plan', [['↗', 'Internships & jobs', 'tasks'], ['◈', 'Portfolio', 'tasks']]],
      ];
      const clock = svg('svg', { width: 140, height: 140, viewBox: '0 0 120 120', role: 'img', 'aria-label': 'Analog clock' });
      const ticks = svg('g', { 'stroke-width': 2, 'stroke-linecap': 'round', class: 'st-clock-ticks' });
      for (let i = 0; i < 12; i++) ticks.append(svg('line', { x1: 60, y1: 6, x2: 60, y2: i % 3 === 0 ? 14 : 11, transform: `rotate(${i * 30} 60 60)` }));
      refs.hour = svg('line', { x1: 60, y1: 60, x2: 60, y2: 32, 'stroke-width': 3, 'stroke-linecap': 'round', class: 'st-hand' });
      refs.min = svg('line', { x1: 60, y1: 60, x2: 60, y2: 18, 'stroke-width': 2, 'stroke-linecap': 'round', class: 'st-hand' });
      refs.sec = svg('line', { x1: 60, y1: 66, x2: 60, y2: 16, 'stroke-width': 1, 'stroke-linecap': 'round', class: 'st-hand-accent' });
      refs.clockDigital = svg('text', { x: 60, y: 84, 'font-size': 8, 'text-anchor': 'middle', class: 'st-axis' });
      clock.append(ticks, refs.hour, refs.min, refs.sec, svg('circle', { cx: 60, cy: 60, r: 3, class: 'st-hand-accent-fill' }), refs.clockDigital);
      refs.clockDigital.textContent = '';
      const clockDate = svg('text', { x: 60, y: 94, 'font-size': 6.5, 'text-anchor': 'middle', class: 'st-axis' });
      clockDate.textContent = `${DOWS[now.getDay()]}, ${MON[now.getMonth()]} ${now.getDate()}`;
      clock.append(clockDate);
      return h('aside', { class: 'st-rail' },
        h('div', { class: 'st-card st-clock-card' }, clock,
          h('div', { class: 'st-progress' }, progress.map(([label, pct]) => h('div', { class: 'st-progress-row' },
            h('div', { class: 'st-progress-box' }, h('div', { class: 'st-progress-fill', style: `width: ${pct}%` })),
            h('span', { class: 'tiny st-text2' }, `${label}: ${pct}%`))))),
        h('div', { class: 'st-card st-panel2' }, h('h2', { class: 'st-rail-title' }, 'Quick actions'),
          quick.map(([g, label, anchor]) => h('a', { href: `#${anchor}`, class: 'st-quick' }, h('span', { class: 'st-quick-glyph', 'aria-hidden': 'true' }, g), label))),
        h('div', { class: 'st-card st-panel2' }, h('h2', { class: 'st-rail-title' }, 'Goal tracker'), h('div', { class: 'st-stack' }, quarters)),
        rails.map(([title, items]) => h('nav', { class: 'st-card st-panel2', 'aria-label': title }, h('h2', { class: 'st-rail-title' }, title),
          items.map(([g, label, anchor]) => h('a', { href: `#${anchor}`, class: 'st-nav-link' }, h('span', { class: 'st-nav-glyph', 'aria-hidden': 'true' }, g), label)))));
    }

    function courses() {
      const tiles = S().courses.map((c, i) => {
        const pct = c.total ? Math.round(c.done / c.total * 100) : 0;
        const open = S().tasks.filter(t => t.courseId === c.id && t.status !== 'Done').length;
        return h('div', { class: 'st-course' },
          pixelCanvas(24, 10, 'city', PALETTES[c.paletteIndex % PALETTES.length], 11 + c.paletteIndex * 13 + i * 7, 'st-course-art'),
          deleteButton(`Delete course ${c.name}`, () => { S().courses = S().courses.filter(x => x !== c); S().tasks.forEach(t => { if (t.courseId === c.id) t.courseId = null; }); change(); draw(); }),
          h('div', { class: 'st-course-body' },
            h('div', { class: 'st-course-name' }, h('span', { class: 'st-mono tiny st-muted', 'aria-hidden': 'true' }, c.glyph), h('span', { class: 'st-ellipsis' }, c.name)),
            h('div', { class: 'st-course-count' },
              h('span', {}, 'Assignments'),
              h('span', { class: 'st-stepper' },
                h('button', { type: 'button', class: 'st-step', 'aria-label': 'One fewer completed', onclick: () => { if (c.done > 0) c.done -= 1; change(); draw(); } }, '−'),
                h('span', { class: 'st-mono st-count' }, `${c.done}/${c.total}`),
                h('button', { type: 'button', class: 'st-step', 'aria-label': 'One more completed', onclick: () => { if (c.done < c.total) c.done += 1; else { c.total += 1; c.done += 1; } change(); draw(); } }, '+'))),
            h('div', { class: 'st-bar-row' }, h('span', { class: 'st-mono tiny' }, `${pct}%`), h('div', { class: 'st-thin' }, h('div', { class: 'st-thin-fill accent', style: `width: ${pct}%` }))),
            h('div', { class: 'tiny st-muted' }, `${open} open tasks · next exam `, h('span', { class: 'st-text' }, c.nextExam))));
      });
      const input = h('input', { id: 'st-course-new', class: 'st-input', placeholder: 'e.g. Linear Algebra', value: ui.courseDraft, onkeydown: e => { if (e.key === 'Enter') add(); }, oninput: e => { ui.courseDraft = e.target.value; } });
      const add = () => {
        const v = ui.courseDraft.trim(); if (!v) return;
        S().courses.push({ id: 'c' + uid(), name: v, glyph: '◆', paletteIndex: S().courses.length % PALETTES.length, done: 0, total: 3, nextExam: 'TBD' });
        ui.courseDraft = ''; change(); draw();
      };
      return h('section', { id: 'courses', class: 'st-section' },
        h('h2', { class: 'st-h2' }, 'Courses'),
        h('div', { class: 'st-course-grid' }, tiles,
          h('div', { class: 'st-course-add' },
            h('label', { for: 'st-course-new', class: 'tiny st-muted' }, 'New course'), input,
            h('button', { type: 'button', class: 'btn-accent', onclick: add }, '+ Add course'),
            h('span', { class: 'tiny st-muted' }, 'Gets its own pixel cover automatically.'))));
    }

    function sectionTiles() {
      const specs = [['Assignments', 'groveDay', 'forest', String(S().tasks.filter(t => t.status !== 'Done').length), 'tasks'],
        ['Timetable', 'dusk', 'city', `${S().courses.length} courses`, 'timetable'], ['To-dos', 'rain', 'city', String(S().todos.length), 'todos'],
        ['Calendar', 'neon', 'city', String(S().tasks.filter(t => t.day !== null).length), 'calendar']];
      return h('div', { class: 'st-tiles' }, specs.map(([name, pal, kind, count, anchor], i) => h('a', { href: `#${anchor}`, class: 'st-tile-card' },
        pixelCanvas(28, 10, kind, pal === 'groveDay' ? 'groveDay' : pal, 101 + i * 29, 'st-tile-art'),
        h('div', { class: 'st-tile-foot' }, h('span', {}, name), h('span', { class: 'st-mono tiny st-muted' }, count)))));
    }

    function wheel() {
      const cx = 150, cy = 122, R = 86;
      const n = S().wheel.length;
      const pt = (i, k) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k]; };
      const ring = k => S().wheel.map((_, i) => pt(i, k).map(v => v.toFixed(1)).join(',')).join(' ');
      const radar = svg('g', {});
      for (const k of [0.25, 0.5, 0.75, 1]) radar.append(svg('polygon', { points: ring(k), fill: 'none', class: 'st-ring' }));
      S().wheel.forEach((_, i) => { const p = pt(i, 1); radar.append(svg('line', { x1: cx, y1: cy, x2: p[0].toFixed(1), y2: p[1].toFixed(1), class: 'st-ring' })); });
      radar.append(svg('polygon', { points: S().wheel.map((w, i) => pt(i, w.value / 10).map(v => v.toFixed(1)).join(',')).join(' '), class: 'st-radar', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      S().wheel.forEach((w, i) => {
        const p = pt(i, 1.14), dx = p[0] - cx;
        const t = svg('text', { x: p[0].toFixed(1), y: (p[1] + 4).toFixed(1), 'font-size': 10, 'text-anchor': Math.abs(dx) < 5 ? 'middle' : (dx > 0 ? 'start' : 'end'), class: 'st-label' });
        t.textContent = `${w.area} · ${w.value}`;
        radar.append(t);
      });
      return h('section', { id: 'wheel', class: 'st-card st-half' },
        h('h2', { class: 'st-h2-tight' }, 'Wheel of life'),
        h('p', { class: 'tiny st-muted' }, 'Drag the sliders to rate each area out of 10.'),
        h('svg', { viewBox: '0 0 300 250', width: '100%', role: 'img', 'aria-label': 'Radar chart of six life areas', class: 'st-radar-svg' }, radar),
        h('div', { class: 'st-sliders' }, S().wheel.map((w, i) => h('label', { class: 'st-slider' },
          h('span', { class: 'st-row-between tiny' }, h('span', { class: 'st-text2' }, w.area), h('span', { class: 'st-mono st-text' }, String(w.value))),
          h('input', {
            type: 'range', min: 1, max: 10, step: 1, value: w.value, 'aria-label': `${w.area} rating`,
            oninput: e => { w.value = parseInt(e.target.value, 10); change(); draw(); },
          })))));
    }

    function pomodoro() {
      const bg = pixelCanvas(32, 14, 'city', 'rain', 333, 'st-pomo-art');
      const modes = MODES.map(([id, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': ui.mode === id ? 'true' : 'false', class: `st-mode${ui.mode === id ? ' on' : ''}`,
        onclick: () => { ui.mode = id; ui.left = MODES.find(m => m[0] === id)[2]; ui.running = false; draw(); },
      }, label));
      refs.pomoTime = h('div', { class: 'st-pomo-time' });
      refs.sessions = h('div', { class: 'st-pomo-sessions' });
      return h('section', { 'aria-label': 'Pomodoro timer', class: 'st-pomo' },
        bg, h('div', { class: 'st-pomo-scrim', 'aria-hidden': 'true' }),
        h('div', { role: 'radiogroup', 'aria-label': 'Timer mode', class: 'st-modes' }, modes),
        refs.pomoTime,
        h('div', { class: 'st-pomo-actions' },
          h('button', {
            type: 'button', class: 'st-pomo-btn', ref: el => { refs.pomoBtn = el; },
            onclick: () => { if (ui.left === 0) { ui.left = curMode()[2]; ui.running = false; } else ui.running = !ui.running; updateLive(); },
          }, 'Start'),
          h('button', { type: 'button', class: 'st-pomo-reset', 'aria-label': 'Reset timer', onclick: () => { ui.left = curMode()[2]; ui.running = false; updateLive(); } },
            svg2('M4 4v6h6', 'M5.5 15a7 7 0 1 0 1.6-7.3L4 10'))),
        refs.sessions);
    }

    function svg2(a, b) {
      const s = svg('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'aria-hidden': 'true' });
      s.append(svg('path', { d: a }), svg('path', { d: b }));
      return s;
    }

    function todosAndReminders() {
      const left = S().todos.filter(t => !t.done).length;
      const todoInput = h('input', { id: 'st-todo-new', class: 'st-input', placeholder: 'New to-do…', value: ui.todoDraft, onkeydown: e => { if (e.key === 'Enter') addTodo(); }, oninput: e => { ui.todoDraft = e.target.value; } });
      const addTodo = () => { const v = ui.todoDraft.trim(); if (!v) return; S().todos.push({ id: 'd' + uid(), text: v, done: false }); ui.todoDraft = ''; change(); draw(); };
      const dateInput = h('input', { id: 'st-rem-date', class: 'st-input narrow', placeholder: 'Nov 5', value: ui.remDate, oninput: e => { ui.remDate = e.target.value; } });
      const textInput = h('input', { id: 'st-rem-text', class: 'st-input', placeholder: 'What’s happening?', value: ui.remText, onkeydown: e => { if (e.key === 'Enter') addRem(); }, oninput: e => { ui.remText = e.target.value; } });
      const addRem = () => { const v = ui.remText.trim(); if (!v) return; S().reminders.push({ id: 'r' + uid(), date: ui.remDate.trim() || 'Soon', text: v }); ui.remText = ''; ui.remDate = ''; change(); draw(); };
      return h('div', { class: 'st-row-wrap' },
        h('section', { id: 'todos', class: 'st-card st-half' },
          h('h2', { class: 'st-h2-tight' }, 'Mini to-dos ', h('span', { class: 'st-muted small' }, `· ${left} left`)),
          h('div', { class: 'st-add-row' }, h('label', { for: 'st-todo-new', class: 'sr-only' }, 'New to-do'), todoInput, h('button', { type: 'button', class: 'btn-solid', onclick: addTodo }, 'Add')),
          h('div', { class: 'st-list' }, S().todos.map(t => h('div', { class: 'st-todo' },
            h('button', { type: 'button', class: 'st-todo-toggle', 'aria-pressed': t.done ? 'true' : 'false', onclick: () => { t.done = !t.done; change(); draw(); } },
              h('span', { class: `st-box${t.done ? ' on' : ''}`, 'aria-hidden': 'true' }, t.done ? '✓' : ''),
              h('span', { class: t.done ? 'st-done-text' : '' }, t.text)),
            deleteButton('Delete to-do', () => { S().todos = S().todos.filter(x => x !== t); change(); draw(); }))))),
        h('section', { id: 'reminders', class: 'st-card st-half' },
          h('h2', { class: 'st-h2-tight' }, 'Reminders & events'),
          h('div', { class: 'st-add-row' }, h('label', { for: 'st-rem-date', class: 'sr-only' }, 'Reminder date'), dateInput,
            h('label', { for: 'st-rem-text', class: 'sr-only' }, 'Reminder'), textInput, h('button', { type: 'button', class: 'btn-solid', onclick: addRem }, 'Add')),
          h('ul', { class: 'st-rems' }, S().reminders.map(r => h('li', { class: 'st-rem' },
            h('span', { class: 'st-mono tiny st-accent-text' }, r.date), h('span', { class: 'flex-1 st-text2' }, r.text),
            deleteButton('Delete reminder', () => { S().reminders = S().reminders.filter(x => x !== r); change(); draw(); }))))));
    }

    function tasksSection() {
      const now = new Date(ui.now);
      const dow = (now.getDay() + 6) % 7;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
      const dayDate = d => { const x = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d); return `${MON[x.getMonth()]} ${x.getDate()}`; };
      const filters = { week: t => t.day !== null, undated: t => t.day === null, priority: () => true };
      const tabs = TABS.map(([id, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': ui.tab === id ? 'true' : 'false', class: `st-tab${ui.tab === id ? ' on' : ''}`,
        onclick: () => { ui.tab = id; draw(); },
      }, `${label} `, h('span', { class: 'st-tab-count' }, S().tasks.filter(filters[id]).length)));
      let list = S().tasks.filter(filters[ui.tab]).slice();
      if (ui.tab === 'week') list.sort((a, b) => a.day - b.day);
      if (ui.tab === 'priority') list.sort((a, b) => ['High', 'Medium', 'Low'].indexOf(a.priority) - ['High', 'Medium', 'Low'].indexOf(b.priority));
      const courseLabel = id => { const c = S().courses.find(x => x.id === id); return c ? `${c.glyph} ${c.name}` : '— Personal'; };
      const rows = list.map(t => {
        const done = t.status === 'Done';
        return h('div', { class: 'st-task-row' },
          h('button', { type: 'button', class: `st-check${done ? ' on' : ''}`, 'aria-label': `Mark ${t.name}${done ? ' not done' : ' done'}`, 'aria-pressed': done ? 'true' : 'false', onclick: () => { t.status = done ? 'Not started' : 'Done'; change(); draw(); } }, done ? '✓' : ''),
          h('span', { class: `st-task-name${done ? ' done' : ''}` }, t.name),
          h('span', { class: 'st-task-course' }, courseLabel(t.courseId)),
          chip(t.priority, PRIO_TONE[t.priority], { title: `Priority ${t.priority}, click to change`, onclick: () => { t.priority = L.cycle(L.STUDY_PRIORITY, t.priority); change(); draw(); } }),
          chip(`● ${t.status}`, STATUS_TONE[t.status], { title: `Status ${t.status}, click to change`, onclick: () => { t.status = L.cycle(L.STUDY_STATUS, t.status); change(); draw(); } }),
          h('span', { class: 'st-mono tiny st-muted' }, t.day === null ? '—' : `${WK[t.day]} · ${dayDate(t.day)}`),
          deleteButton('Delete task', () => { S().tasks = S().tasks.filter(x => x !== t); change(); draw(); }));
      });
      const name = h('input', { id: 'st-task-new', class: 'st-input grow', placeholder: 'New task…', value: ui.taskDraft, onkeydown: e => { if (e.key === 'Enter') addTask(); }, oninput: e => { ui.taskDraft = e.target.value; } });
      const courseSel = h('select', { class: 'st-select', 'aria-label': 'Course', onchange: e => { ui.taskCourse = e.target.value; } },
        [...S().courses.map(c => h('option', { value: c.id }, c.name)), h('option', { value: 'none' }, 'Personal')]);
      courseSel.value = ui.taskCourse;
      const daySel = h('select', { class: 'st-select', 'aria-label': 'Day', onchange: e => { ui.taskDay = e.target.value; } },
        [h('option', { value: 'none' }, 'No date'), ...WK.map((d, i) => h('option', { value: String(i) }, `${d} ${dayDate(i)}${i === dow ? ' (today)' : ''}`))]);
      daySel.value = ui.taskDay;
      const prioSel = h('select', { class: 'st-select', 'aria-label': 'Priority', onchange: e => { ui.taskPrio = e.target.value; } }, ['Low', 'Medium', 'High'].map(p => h('option', { value: p }, p)));
      prioSel.value = ui.taskPrio;
      const addTask = () => {
        const v = ui.taskDraft.trim(); if (!v) return;
        S().tasks.push({ id: 's' + uid(), name: v, courseId: ui.taskCourse === 'none' ? null : ui.taskCourse, priority: ui.taskPrio, status: 'Not started', day: ui.taskDay === 'none' ? null : parseInt(ui.taskDay, 10) });
        ui.taskDraft = ''; change(); draw();
      };
      return h('section', { id: 'tasks', class: 'st-card' },
        h('h2', { class: 'st-h2-tight' }, 'Task manager'),
        h('div', { role: 'tablist', 'aria-label': 'Task view', class: 'st-tabs' }, tabs),
        h('div', { class: 'st-table-scroll' }, h('div', { class: 'st-table' }, rows.length ? rows : h('div', { class: 'st-empty' }, 'No tasks in this view.'))),
        h('div', { class: 'st-add-box' },
          h('label', { for: 'st-task-new', class: 'sr-only' }, 'New task'), name,
          h('label', { class: 'st-inline-label' }, 'Course', courseSel),
          h('label', { class: 'st-inline-label' }, 'Day', daySel),
          h('label', { class: 'st-inline-label' }, 'Priority', prioSel),
          h('button', { type: 'button', class: 'btn-accent', onclick: addTask }, '+ Add task')));
    }

    function timetable() {
      const cells = [];
      S().timetable.forEach((row, ri) => {
        cells.push(h('div', { class: 'st-tt-time' }, SLOTS[ri]));
        row.forEach((k, ci) => {
          if (k === 'LUNCH') { cells.push(h('div', { class: 'st-tt-lunch' }, 'Lunch')); return; }
          const c = S().courses.find(x => x.id === k);
          cells.push(h('button', {
            type: 'button', class: `st-tt-slot${c ? ' filled' : ''}`, 'aria-label': `${c ? c.name : 'Empty slot'}, ${TT_HEAD[ci + 1]} ${SLOTS[ri]}. Click to change`,
            style: c ? `box-shadow: inset 3px 0 0 ${TINT[c.paletteIndex % TINT.length]}` : '',
            onclick: () => {
              const ids = ['', ...S().courses.map(x => x.id)];
              const idx = ids.indexOf(S().timetable[ri][ci]);
              S().timetable[ri][ci] = ids[(idx + 1) % ids.length];
              change(); draw();
            },
          }, c ? `${c.glyph} ${c.name}` : '+'));
        });
      });
      return h('section', { id: 'timetable', class: 'st-card' },
        h('div', { class: 'st-row-between wrap' }, h('h2', { class: 'st-h2-tight' }, 'Timetable'), h('span', { class: 'small st-muted' }, 'Click a slot to cycle through your courses')),
        h('div', { class: 'st-table-scroll' }, h('div', { class: 'st-tt' },
          TT_HEAD.map(t => h('div', { class: 'st-tt-head' }, t)), cells)));
    }

    function calendarSection() {
      const now = new Date(ui.now);
      const dow = (now.getDay() + 6) % 7;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      const range = `${MON[monday.getMonth()]} ${monday.getDate()} – ${MON[sunday.getMonth()]} ${sunday.getDate()}`;
      const days = WK.map((dw, i) => {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        const isToday = i === dow;
        return h('div', { class: `st-cal-col${isToday ? ' today' : ''}${i > 4 ? ' weekend' : ''}` },
          h('div', { class: 'st-cal-head' }, h('span', {}, dw), h('span', { class: isToday ? 'st-cal-today' : 'strong' }, String(d.getDate()))),
          S().tasks.filter(t => t.day === i).map(t => h('div', { class: 'st-cal-item' },
            h('div', { class: 'strong' }, t.name),
            h('div', { class: 'st-cal-course' }, (S().courses.find(c => c.id === t.courseId) || { name: 'Personal' }).name),
            h('div', { class: 'st-cal-chips' }, chip(t.priority, PRIO_TONE[t.priority]), chip(`● ${t.status}`, STATUS_TONE[t.status])))));
      });
      return h('section', { id: 'calendar', class: 'st-card' },
        h('h2', { class: 'st-h2-tight' }, 'Academic calendar'),
        h('div', { class: 'st-row-between wrap small' }, h('strong', {}, range), h('span', { class: 'st-muted tiny' }, 'Tasks with a day appear here automatically')),
        h('div', { class: 'st-table-scroll' }, h('div', { class: 'st-cal' }, days)));
    }

    // ---------- render ----------
    function pickTheme(v) { theme = v; page.theme = v; change(); draw(); }

    function notesWidget() {
      return h('textarea', {
        class: 'tpl-notes', 'aria-label': 'Notes', placeholder: 'Write anything here…',
        ref: el => { el.value = S().notes; },
        oninput: e => { S().notes = e.target.value; change(); },
      });
    }
    function draw() {
      const d = null;
      refs = {};
      container.innerHTML = '';
      container.className = 'tpl tpl-study';
      container.dataset.template = 'study';
      container.dataset.theme = theme;
      const pick = id => todosAndReminders().querySelector('#' + id);
      const builtins = {
        courses: { title: 'Courses', render: courses },
        tiles: { title: 'Sections', render: sectionTiles },
        wheel: { title: 'Wheel of life', render: wheel },
        pomodoro: { title: 'Pomodoro', render: pomodoro },
        todos: { title: 'Mini to-dos', render: () => pick('todos') },
        reminders: { title: 'Reminders & events', render: () => pick('reminders') },
        tasks: { title: 'Task manager', render: tasksSection },
        timetable: { title: 'Timetable', render: timetable },
        calendar: { title: 'Academic calendar', render: calendarSection },
        notes: { title: 'Notes', render: notesWidget },
      };
      const ctl = FolioCustom.controller(S, builtins, { change, draw, setLayout: layout => { S().layout = layout; change(); draw(); } });
      const grid = FolioBoard.board({
        layout: S().layout, registry: ctl.registry,
        onLayout: layout => { S().layout = layout; change(); draw(); },
        onAdd: ctl.onAdd, onEdit: ctl.onEdit, onRedraw: draw,
      });
      container.append(
        h('div', { class: 'st-page' },
          banner(d),
          h('div', { class: 'st-body' },
            header(),
            h('div', { class: 'st-layout' }, rail(d), h('div', { class: 'st-main' }, grid)))));
      updateLive();
    }

    draw();
    startTimer();
    return {
      destroy() { stopTimer(); document.removeEventListener('visibilitychange', onVisibility); container.innerHTML = ''; },
      get theme() { return theme; },
    };
  }

  window.FolioStudy = { mount };
})();
