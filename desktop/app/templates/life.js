// Life OS template. Structure and copy follow design/Life.dc.html; logic lives in template-logic.js.
// Persisted: page.title, page.subtitle, page.theme, page.state (priorities, tasks, habits, pomodoro settings, sound).
// Ephemeral: timer state, the open tab, the clock, drafts. Each change calls onChange(), which the app saves.
(function () {
  const { h, chip, segmented, deleteButton, inlineInput } = FolioUI;
  const L = FolioTemplates;
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const TAB_DEFS = [['open', '! Uncompleted'], ['today', '↓ Due today'], ['tomorrow', '→ Due tomorrow'], ['none', '? No date'], ['all', '∞ All']];
  const STATUS_TONE = { 'In progress': 'amber', 'To-do': 'red', Done: 'green', 'Not started': 'gray' };
  const PRIORITY_TONE = { 'Very urgent': 'red', Urgent: 'amber', Normal: 'green', Low: 'gray' };
  const DIFFICULTY_TONE = { Easy: 'green', Normal: 'blue', Hard: 'red', 'Very hard': 'purple' };
  const CAL_BG = { Done: 'cal-done', 'In progress': 'cal-prog', 'To-do': 'cal-todo', 'Not started': 'cal-none' };
  const SOUNDS = [['rain', 'Rain', 'Soft rain on a window'], ['forest', 'Forest', 'Birds and wind'], ['cafe', 'Café', 'Vintage café murmur'], ['lofi', 'Lo-fi', 'Slow beats to focus']];
  const pad = n => (n < 10 ? '0' : '') + n;
  const uid = () => Math.random().toString(36).slice(2, 10);

  function mount(container, page, opts) {
    const S = () => page.state;
    const ui = {
      tab: 'open', playing: false, now: Date.now(),
      phase: 'work', running: false, cycles: 0, left: S().pomodoro.workMin * 60,
      taskDay: 'none', taskPrio: 'Normal',
    };
    let timer = null;
    let refs = {};
    let theme = page.theme || opts.resolvedTheme;

    const change = () => { opts.onChange(); };

    // ---------- derived values ----------
    function dateInfo() {
      const now = new Date(ui.now);
      const y = now.getFullYear();
      const startY = new Date(y, 0, 1), endY = new Date(y + 1, 0, 1);
      const dim = new Date(y, now.getMonth() + 1, 0).getDate();
      const dow = now.getDay();
      const dowMon = (dow + 6) % 7;
      const sunday = new Date(y, now.getMonth(), now.getDate() - dow);
      return {
        now, y, dow, dowMon,
        yearPct: Math.floor((now - startY) / (endY - startY) * 100),
        dayOfYear: Math.floor((now - startY) / 864e5) + 1,
        daysInYear: Math.round((endY - startY) / 864e5),
        monthPct: Math.floor(((now.getDate() - 1) + now.getHours() / 24) / new Date(y, now.getMonth() + 1, 0).getDate() * 100),
        weekPct: Math.floor((dowMon + now.getHours() / 24) / 7 * 100),
        dayPct: Math.floor((now.getHours() * 60 + now.getMinutes()) / 1440 * 100),
        sunday,
      };
    }

    // ---------- live values (clock, progress, pomodoro) updated every second ----------
    function updateLive() {
      const d = dateInfo();
      const set = (k, text) => { if (refs[k]) refs[k].textContent = text; };
      set('clock', pad(d.now.getHours()) + ':' + pad(d.now.getMinutes()));
      set('yearPct', d.yearPct + '%');
      set('yearDay', `Day ${d.dayOfYear} of ${d.daysInYear}`);
      if (refs.yearRing) refs.yearRing.setAttribute('stroke-dasharray', `${(2 * Math.PI * 21 * d.yearPct / 100).toFixed(1)} ${(2 * Math.PI * 21).toFixed(1)}`);
      set('monthPct', d.monthPct + '%');
      set('weekPct', d.weekPct + '%');
      set('dayPct', d.dayPct + '%');
      if (refs.monthBar) refs.monthBar.style.width = d.monthPct + '%';
      if (refs.dayBar) refs.dayBar.style.width = d.dayPct + '%';
      const mm = Math.floor(ui.left / 60), ss = ui.left % 60;
      set('pomoTime', pad(mm) + ':' + pad(ss));
      set('pomoPhase', `${ui.phase === 'work' ? 'Focus' : 'Break'} · cycle ${Math.min(4, ui.cycles + 1)} of 4`);
      set('cyclesDone', `${ui.cycles} / 4`);
      if (refs.pomoTime) refs.pomoTime.classList.toggle('is-break', ui.phase !== 'work');
      if (refs.pomoDot) refs.pomoDot.classList.toggle('on', ui.running);
      (refs.cycleBars || []).forEach((bar, i) => {
        bar.className = 'cycle-bar' + (i < ui.cycles ? ' done' : (i === ui.cycles && ui.phase === 'work' ? ' current' : ''));
      });
      if (refs.pomoBtn) refs.pomoBtn.textContent = ui.running ? 'Pause' : 'Start';
    }

    function startTimer() {
      if (timer || document.hidden) return;
      timer = setInterval(tick, 1000);
    }
    function stopTimer() { clearInterval(timer); timer = null; }
    function tick() {
      ui.now = Date.now();
      if (ui.running) Object.assign(ui, L.pomodoroTick(ui, S().pomodoro));
      updateLive();
    }
    const onVisibility = () => {
      if (document.hidden) stopTimer();
      else { startTimer(); tick(); }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ---------- sections ----------
    function cover(d) {
      const cov = h('div', { class: 'lf-cover' },
        h('svg', { class: 'lf-cover-art', viewBox: '0 0 1440 230', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' },
          h('defs', {}, skyGradient()),
          h('rect', { width: 1440, height: 230, fill: 'url(#lsky)' }),
          h('path', { class: 'lf-mtn-1', d: 'M0 170 L120 120 L230 150 L360 90 L480 140 L600 100 L720 150 L860 80 L980 130 L1120 95 L1260 140 L1440 110 L1440 230 L0 230 Z' }),
          h('path', { class: 'lf-mtn-2', d: 'M0 200 L160 150 L300 185 L440 140 L580 190 L740 135 L900 185 L1060 145 L1220 190 L1440 150 L1440 230 L0 230 Z' }),
          h('path', { class: 'lf-ridge', d: 'M0 230 L0 215 L200 195 L420 220 L640 200 L860 222 L1100 198 L1300 220 L1440 205 L1440 230 Z' })),
        h('div', { class: 'lf-cover-bar' },
          h('span', { class: 'lf-year' }, `© ${d.y}`),
          segmented('Theme', [{ value: 'dark', label: '☾ Dark' }, { value: 'light', label: '☀ Light' }], theme, pickTheme)));
      return cov;
    }

    function skyGradient() {
      const svgNS = 'http://www.w3.org/2000/svg';
      const g = document.createElementNS(svgNS, 'linearGradient');
      g.setAttribute('id', 'lsky'); g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '0'); g.setAttribute('y2', '1');
      [['0', 'sky-0'], ['0.55', 'sky-1'], ['0.85', 'sky-2'], ['1', 'sky-3']].forEach(([off, cls]) => {
        const s = document.createElementNS(svgNS, 'stop');
        s.setAttribute('offset', off);
        s.setAttribute('class', 'lf-' + cls);
        g.append(s);
      });
      return g;
    }

    function header() {
      const title = h('input', { id: 'life-title', class: 'lf-title-input', value: page.title, onchange: e => { page.title = e.target.value.trim() || 'Life OS'; change(); } });
      const sub = h('input', { id: 'life-sub', class: 'lf-sub-input', value: page.subtitle, onchange: e => { page.subtitle = e.target.value; change(); } });
      return h('div', {},
        h('div', { class: 'lf-head' },
        h('span', { class: 'lf-icon-tile', 'aria-hidden': 'true' }, iconSvg('M3 20l6-10 4 6 3-4 5 8z', 'M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0')),
        h('div', { class: 'lf-head-text' },
          h('label', { for: 'life-title', class: 'sr-only' }, 'Page title'), title,
          h('label', { for: 'life-sub', class: 'sr-only' }, 'Page description'), sub),
        ),
      h('p', { class: 'lf-hint' }, iconSvg('M4 20h4L19 9l-4-4L4 16z', null, 14), 'Everything here is editable — rename the page, add tasks and habits, click any chip to change it.'));
    }

    function navGroups() {
      const item = (label, glyph, anchor, tone) => h('a', { href: '#' + anchor, class: 'lf-nav-item' + (tone ? ' tone-' + tone : '') },
        h('span', { class: 'lf-nav-glyph', 'aria-hidden': 'true' }, glyph), label);
      const groups = [
        ['Planners', [item('Start here', '?', 'priorities', 'blue'), item('Today', '◷', 'tasks'), item('Week', '▦', 'week'), item('Tasks', '☰', 'tasks'), item('Distractions log', '◎', 'stats')]],
        ['Personal', [item('Best self', '✦', 'priorities'), item('Notes & thoughts', '✎', 'priorities')]],
        ['Accountability', [item('Habit tracker', '▤', 'habits')]],
        ['Misc', [item('Ambient room', '♪', 'tasks', 'green'), item('About', 'i', 'priorities'), item('Second brain', '◈', 'priorities', 'red')]],
      ];
      return h('nav', { class: 'lf-nav', 'aria-label': 'Life OS sections' }, groups.map(([title, items]) =>
        h('div', { class: 'lf-nav-group' }, h('div', { class: 'lf-nav-title' }, title), h('div', { class: 'lf-nav-items' }, items))));
    }

    function todayCard(d) {
      const open = S().tasks.filter(t => t.status !== 'Done').length;
      const habitsLeft = S().habits.filter(hb => !hb.days[34]).length;
      const hr = d.now.getHours();
      const greeting = hr < 12 ? 'Good morning — make it count.' : hr < 18 ? 'Good afternoon — keep the momentum.' : 'Good evening — wind down well.';
      return h('div', { class: 'lf-card lf-today' },
        h('div', {},
          h('div', { class: 'lf-eyebrow' }, DOW[d.dow].toUpperCase()),
          h('div', { class: 'lf-date' }, `${MON[d.now.getMonth()]} ${d.now.getDate()}`),
          h('div', { class: 'lf-muted' }, greeting)),
        h('div', { class: 'lf-today-side' },
          h('span', { class: 'lf-clock', ref: el => { refs.clock = el; } }, pad(d.now.getHours()) + ':' + pad(d.now.getMinutes())),
          chip(`${open} tasks open`, 'amber'),
          chip(`${habitsLeft} habits left today`, 'green')));
    }

    function soundCard() {
      const cur = SOUNDS.find(s => s[0] === S().ambientSound) || SOUNDS[0];
      return h('div', { class: 'lf-card lf-sound' },
        h('button', { type: 'button', class: 'lf-play', 'aria-label': ui.playing ? 'Pause sound' : 'Play sound', onclick: () => { ui.playing = !ui.playing; draw(); } },
          ui.playing ? iconSvg('M6 5h4v14H6zM14 5h4v14h-4z', null, 16, true) : iconSvg('M8 5l11 7-11 7z', null, 16, true)),
        h('div', { class: 'lf-sound-text' },
          h('div', { class: 'strong' }, cur[1]),
          h('div', { class: 'lf-muted small' }, ui.playing ? 'Playing · ambient loop' : 'Paused · pick a mood')),
        h('div', { class: 'lf-sound-picks' }, SOUNDS.map(([id, label]) => h('button', {
          type: 'button', class: 'lf-sound-pick' + (S().ambientSound === id ? ' on' : ''), 'aria-pressed': S().ambientSound === id ? 'true' : 'false',
          onclick: () => { S().ambientSound = id; ui.playing = true; change(); draw(); },
        }, label))));
    }

    function progressCard(d) {
      const circ = 2 * Math.PI * 21;
      refs.yearRing = svgEl('circle', { cx: 26, cy: 26, r: 21, fill: 'none', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': `${(circ * d.yearPct / 100).toFixed(1)} ${circ.toFixed(1)}`, transform: 'rotate(-90 26 26)', class: 'lf-ring-fg' });
      const weekPills = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => h('span', {
        class: 'lf-week-pill' + (i === d.dowMon ? ' today' : (i < d.dowMon ? ' past' : '')),
      }, l));
      const bar = (name, pct, ref) => h('div', { class: 'lf-bar' }, h('div', { class: 'lf-bar-fill', ref: el => { refs[ref] = el; }, style: `width: ${pct}%` }));
      return h('div', { class: 'lf-card' },
        h('div', { class: 'lf-row-between' },
          h('div', {},
            h('div', { class: 'lf-muted small' }, 'Year progress'),
            h('div', { class: 'lf-big accent-text', ref: el => { refs.yearPct = el; } }, d.yearPct + '%'),
            h('div', { class: 'lf-muted small', ref: el => { refs.yearDay = el; } }, `Day ${d.dayOfYear} of ${d.daysInYear}`)),
          h('svg', { width: 52, height: 52, viewBox: '0 0 52 52', 'aria-hidden': 'true' },
            svgEl('circle', { cx: 26, cy: 26, r: 21, fill: 'none', 'stroke-width': 5, class: 'lf-ring-bg' }), refs.yearRing)),
        h('div', { class: 'lf-meter-row', style: '' }, h('span', {}, 'Month'), h('span', { class: 'lf-text', ref: el => { refs.monthPct = el; } }, d.monthPct + '%')),
        bar('month', d.monthPct, 'monthBar'),
        h('div', { class: 'lf-meter-row lf-gap' }, h('span', {}, 'Week'), h('span', { class: 'lf-text', ref: el => { refs.weekPct = el; } }, d.weekPct + '%')),
        h('div', { class: 'lf-week-pills' }, weekPills),
        h('div', { class: 'lf-meter-row lf-gap' }, h('span', {}, 'Day'), h('span', { class: 'lf-text', ref: el => { refs.dayPct = el; } }, d.dayPct + '%')),
        bar('day', d.dayPct, 'dayBar'));
    }

    function pomodoroCard() {
      const s = S().pomodoro;
      const stepper = (label, value, unit, onDown, onUp, minLabel, maxLabel) => h('div', { class: 'lf-stepper' },
        h('span', { class: 'lf-muted' }, label),
        h('button', { type: 'button', class: 'lf-step', 'aria-label': minLabel, onclick: onDown }, '−'),
        h('span', { class: 'lf-mono step-val' }, `${value}m`),
        h('button', { type: 'button', class: 'lf-step', 'aria-label': maxLabel, onclick: onUp }, '+'));
      const setPomo = (key, delta, min, max) => () => {
        S().pomodoro[key] = Math.min(max, Math.max(min, S().pomodoro[key] + delta));
        if (!ui.running && ((key === 'workMin' && ui.phase === 'work') || (key === 'breakMin' && ui.phase === 'break'))) ui.left = S().pomodoro[key] * 60;
        change(); updateLive(); draw();
      };
      refs.cycleBars = [0, 1, 2, 3].map(() => h('span', { class: 'cycle-bar' }));
      refs.pomoTime = h('div', { class: 'lf-pomo-time' });
      refs.pomoDot = h('span', { class: 'lf-pomo-dot' });
      const card = h('div', { class: 'lf-card' },
        h('div', { class: 'lf-row-between' },
          h('div', {},
            h('div', { class: 'lf-muted small' }, 'Pomodoro'),
            refs.pomoTime,
            h('div', { class: 'lf-muted small', ref: el => { refs.pomoPhase = el; } })),
          refs.pomoDot),
        h('div', { class: 'lf-meter-row lf-gap' }, h('span', { class: 'lf-muted' }, 'Cycles'), h('span', { class: 'lf-text', ref: el => { refs.cyclesDone = el; } })),
        h('div', { class: 'lf-cycles' }, refs.cycleBars),
        h('div', { class: 'lf-steppers' },
          stepper('Work', s.workMin, 'm', setPomo('workMin', -5, 5, 90), setPomo('workMin', 5, 5, 90), 'Less work time', 'More work time'),
          stepper('Break', s.breakMin, 'm', setPomo('breakMin', -1, 1, 30), setPomo('breakMin', 1, 1, 30), 'Less break time', 'More break time')),
        h('div', { class: 'lf-pomo-actions' },
          h('button', { type: 'button', class: 'btn-primary', ref: el => { refs.pomoBtn = el; }, onclick: () => { ui.running = !ui.running; updateLive(); } }, ui.running ? 'Pause' : 'Start'),
          h('button', { type: 'button', class: 'btn-ghost', onclick: () => { Object.assign(ui, { running: false, phase: 'work', left: S().pomodoro.workMin * 60, cycles: 0 }); updateLive(); } }, 'Reset'),
          h('button', { type: 'button', class: 'btn-ghost', onclick: () => { Object.assign(ui, L.pomodoroAdvance(ui, S().pomodoro)); updateLive(); } }, 'Skip')));
      updateLive();
      return card;
    }

    function prioritiesSection() {
      const input = h('input', { id: 'prio-new', class: 'lf-input', placeholder: 'Add a priority and press Enter…', onkeydown: e => { if (e.key === 'Enter') add(); } });
      const add = () => { const v = input.value.trim(); if (!v) return; S().priorities.push(v); input.value = ''; change(); draw(); };
      return h('section', { id: 'priorities', class: 'lf-section' },
        h('h2', { class: 'lf-h2' }, 'Problems & priorities'),
        h('div', { class: 'lf-panel-2' },
          h('ol', { class: 'lf-prios' }, S().priorities.map((p, i) => h('li', {},
            h('span', { class: 'lf-prio-row' }, h('span', { class: 'flex-1' }, p),
              deleteButton('Remove priority', () => { S().priorities.splice(i, 1); change(); draw(); }))))),
          h('div', { class: 'lf-add-row' },
            h('label', { for: 'prio-new', class: 'sr-only' }, 'New priority'), input,
            h('button', { type: 'button', class: 'btn-solid', onclick: add }, 'Add'))));
    }

    function tasksSection() {
      const d = dateInfo();
      const bucketOf = t => L.lifeDueBucket(t, d.dow);
      const filters = {
        open: t => t.status !== 'Done', today: t => bucketOf(t) === 'today', tomorrow: t => bucketOf(t) === 'tomorrow',
        none: t => bucketOf(t) === 'none', all: () => true,
      };
      const tabs = TAB_DEFS.map(([id, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': ui.tab === id ? 'true' : 'false', class: 'lf-tab' + (ui.tab === id ? ' on' : ''),
        onclick: () => { ui.tab = id; draw(); },
      }, `${label} `, h('span', { class: 'lf-tab-count' }, S().tasks.filter(filters[id]).length)));
      const dueLabel = t => { const b = bucketOf(t); return b === 'none' ? '—' : b === 'today' ? 'Today' : b === 'tomorrow' ? 'Tomorrow' : DOW3[t.day]; };
      const rows = S().tasks.filter(filters[ui.tab]).map(t => h('div', { class: 'lf-task-row' },
        chip(t.status, STATUS_TONE[t.status], { title: `Status: ${t.status}. Click to change`, onclick: () => { t.status = L.cycle(L.LIFE_STATUS, t.status); change(); draw(); } }),
        h('span', { class: 'lf-task-name' }, t.name),
        h('span', { class: 'lf-mono lf-muted small' }, dueLabel(t)),
        chip(t.priority, PRIORITY_TONE[t.priority], { title: `Priority: ${t.priority}. Click to change`, onclick: () => { t.priority = L.cycle(L.LIFE_PRIORITY, t.priority); change(); draw(); } }),
        deleteButton('Delete task', () => { S().tasks = S().tasks.filter(x => x !== t); change(); draw(); })));
      const name = h('input', { id: 'task-new', class: 'lf-input grow', placeholder: 'New task…', onkeydown: e => { if (e.key === 'Enter') addTask(); } });
      const dayOpts = [h('option', { value: 'none' }, 'No date'), ...DOW3.map((dw, i) => h('option', { value: String(i) }, dw + (i === d.dow ? ' (today)' : '')))];
      const daySel = h('select', { class: 'lf-select', 'aria-label': 'Day', onchange: e => { ui.taskDay = e.target.value; } }, dayOpts);
      daySel.value = ui.taskDay;
      const prioSel = h('select', { class: 'lf-select', 'aria-label': 'Priority', onchange: e => { ui.taskPrio = e.target.value; } },
        L.LIFE_PRIORITY.map(p => h('option', { value: p }, p)));
      prioSel.value = ui.taskPrio;
      const addTask = () => {
        const v = name.value.trim(); if (!v) return;
        S().tasks.push({ id: 't' + uid(), name: v, status: 'To-do', priority: ui.taskPrio, day: ui.taskDay === 'none' ? null : parseInt(ui.taskDay, 10), difficulty: 'Normal', project: 'Inbox' });
        change(); draw();
      };
      return h('section', { id: 'tasks', class: 'lf-section' },
        h('h2', { class: 'lf-h2' }, 'Task overview'),
        h('div', { role: 'tablist', 'aria-label': 'Task filter', class: 'lf-tabs' }, tabs),
        h('div', { class: 'lf-task-list' }, rows.length ? rows : h('div', { class: 'lf-empty' }, 'Nothing here — enjoy the quiet.')),
        h('div', { class: 'lf-add-box' },
          h('label', { for: 'task-new', class: 'sr-only' }, 'New task name'), name,
          h('label', { class: 'lf-inline-label' }, 'Day', daySel),
          h('label', { class: 'lf-inline-label' }, 'Priority', prioSel),
          h('button', { type: 'button', class: 'btn-accent', onclick: addTask }, '+ Add task')));
    }

    function weekSection() {
      const d = dateInfo();
      const sun = d.sunday, sat = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 6);
      const range = `${MON[sun.getMonth()]} ${sun.getDate()} – ${MON[sat.getMonth()]} ${sat.getDate()}, ${sat.getFullYear()}`;
      const cols = DOW3.map((dw, i) => {
        const date = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i);
        const isToday = i === d.dow;
        const items = S().tasks.filter(t => t.day === i).map(t => h('button', {
          type: 'button', class: `lf-cal-card ${CAL_BG[t.status]}`, 'aria-label': `${t.name} — ${t.status}. Click to change status`,
          onclick: () => { t.status = L.cycle(L.LIFE_STATUS, t.status); change(); draw(); },
        },
          h('span', { class: 'lf-cal-name' }, t.name),
          h('span', { class: 'lf-cal-chips' }, chip(t.status, STATUS_TONE[t.status], {}), chip(t.difficulty, DIFFICULTY_TONE[t.difficulty], {})),
          h('span', { class: 'lf-cal-project' }, `↳ ${t.project}`)));
        return h('div', { class: 'lf-cal-col' + (isToday ? ' today' : '') },
          h('div', { class: 'lf-cal-head' }, h('span', {}, dw), h('span', { class: 'lf-cal-num' + (isToday ? ' today' : '') }, date.getDate() === 1 ? `${MON[date.getMonth()]} 1` : String(date.getDate()))),
          items);
      });
      return h('section', { id: 'week', class: 'lf-section lf-gap-xl' },
        h('h2', { class: 'lf-h2' }, 'This week'),
        h('div', { class: 'lf-week-meta' }, h('strong', {}, range), h('span', { class: 'lf-muted small' }, 'Tasks with a day show up here · click a card to change its status')),
        h('div', { class: 'lf-cal-scroll' }, h('div', { class: 'lf-cal' }, cols)));
    }

    function habitsSection() {
      const cards = S().habits.map(hb => h('div', { class: 'lf-habit', ref: el => el.style.setProperty('--hc', L.HABIT_COLORS[hb.colorIndex]) },
        h('div', { class: 'lf-habit-head' },
          h('strong', { class: 'lf-habit-name' }, hb.name),
          h('span', { class: 'lf-habit-streak' },
            h('span', { class: 'lf-mono small lf-muted' }, `${L.habitStreak(hb.days)}d`),
            deleteButton(`Delete habit ${hb.name}`, () => { S().habits = S().habits.filter(x => x !== hb); change(); draw(); }))),
        h('div', { class: 'lf-grid35' }, hb.days.map((v, i) => h('button', {
          type: 'button', 'aria-label': `${hb.name} — day ${i + 1}, ${v ? 'done' : 'not done'}`, 'aria-pressed': v ? 'true' : 'false',
          class: `lf-cell${i === 34 ? ' today' : ''}${v ? ' on' : ''}`,
          onclick: () => { hb.days[i] = !hb.days[i]; change(); draw(); },
        }))),
        h('button', {
          type: 'button', class: `lf-mark${hb.days[34] ? ' done' : ''}`, 'data-color': String(hb.colorIndex),
          onclick: () => { hb.days[34] = !hb.days[34]; change(); draw(); },
        }, hb.days[34] ? 'Done today ✓' : 'Mark done')));
      const input = h('input', { id: 'habit-new', class: 'lf-input', placeholder: 'e.g. Read 20 pages', onkeydown: e => { if (e.key === 'Enter') add(); } });
      const add = () => {
        const v = input.value.trim(); if (!v) return;
        S().habits.push({ id: 'h' + uid(), name: v, colorIndex: S().habits.length % L.HABIT_COLORS.length, days: Array(35).fill(false) });
        input.value = ''; change(); draw();
      };
      return h('section', { id: 'habits', class: 'lf-habits' },
        h('h2', { class: 'lf-h2' }, 'Habits'),
        h('div', { class: 'lf-habit-grid' }, cards,
          h('div', { class: 'lf-habit-new' },
            h('label', { for: 'habit-new', class: 'lf-muted small' }, 'New habit'), input,
            h('button', { type: 'button', class: 'btn-solid', onclick: add }, '+ Add habit'))));
    }

    function statsSection() {
      const totals = L.habitTotals(S().habits);
      const hc = Math.max(1, S().habits.length);
      const pts = totals.map((v, i) => `${(28 + i * (384 / 34)).toFixed(1)},${(200 - v / hc * 180).toFixed(1)}`);
      const best = Math.max(0, ...totals);
      const avg = (totals.reduce((a, b) => a + b, 0) / 35).toFixed(1);
      const svg = h('svg', { viewBox: '0 0 420 220', width: '100%', role: 'img', 'aria-label': 'Line chart of habits completed per day', class: 'lf-chart' },
        h('defs', {}, areaGradient()),
        svgEl('line', { x1: 28, y1: 20, x2: 412, y2: 20, class: 'lf-grid-line' }),
        svgEl('line', { x1: 28, y1: 110, x2: 412, y2: 110, class: 'lf-grid-line' }),
        svgEl('line', { x1: 28, y1: 200, x2: 412, y2: 200, class: 'lf-grid-base' }),
        svgText(20, 24, 'end', String(S().habits.length)), svgText(20, 114, 'end', String(Math.round(S().habits.length / 2))), svgText(20, 204, 'end', '0'),
        svgEl('polygon', { points: `28,200 ${pts.join(' ')} 412,200`, fill: 'url(#lfill)' }),
        svgEl('polyline', { points: pts.join(' '), fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'lf-line' }),
        svgText(28, 216, 'start', '5 weeks ago'), svgText(412, 216, 'end', 'today'));
      return h('section', { id: 'stats', class: 'lf-stats' },
        h('h2', { class: 'lf-h2' }, 'Your stats'),
        h('div', { class: 'lf-card lf-stats-card' },
          h('div', { class: 'lf-row-between wrap' },
            h('div', {}, h('div', { class: 'lf-muted small' }, 'Habits completed per day · last 5 weeks'), h('div', { class: 'lf-big-stat' }, avg, ' ', h('span', { class: 'lf-muted small' }, 'avg / day'))),
            chip(`Best: ${best} / ${S().habits.length}`, 'green')),
          svg));
    }

    function areaGradient() {
      const svgNS = 'http://www.w3.org/2000/svg';
      const g = document.createElementNS(svgNS, 'linearGradient');
      g.setAttribute('id', 'lfill'); g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '0'); g.setAttribute('y2', '1');
      [['0', 'lf-fill-top'], ['1', 'lf-fill-bottom']].forEach(([off, cls]) => {
        const s = document.createElementNS(svgNS, 'stop'); s.setAttribute('offset', off); s.setAttribute('class', cls); g.append(s);
      });
      return g;
    }

    // ---------- SVG helpers ----------
    function svgEl(name, attrs) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
      return el;
    }
    function svgText(x, y, anchor, text) {
      const t = svgEl('text', { x, y, 'font-size': 10, 'text-anchor': anchor, class: 'lf-axis' });
      t.textContent = text;
      return t;
    }
    function iconSvg(path, circle, size = 14, fill = false) {
      const svg = svgEl('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', class: fill ? 'icon-fill' : 'icon-stroke', fill: fill ? 'currentColor' : 'none', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      if (path) svg.append(svgEl('path', { d: path }));
      if (circle) svg.append(svgEl('circle', { cx: 17, cy: 6, r: 2 }));
      return svg;
    }

    function pickTheme(v) {
      theme = v;
      page.theme = v;
      change();
      draw();
    }

    // ---------- render ----------
    function notesWidget() {
      return h('textarea', {
        class: 'tpl-notes', 'aria-label': 'Notes', placeholder: 'Write anything here…',
        ref: el => { el.value = S().notes; },
        oninput: e => { S().notes = e.target.value; change(); },
      });
    }

    function todosWidget() {
      const input = h('input', { class: 'lf-input', placeholder: 'Add a to-do and press Enter…', 'aria-label': 'New to-do', onkeydown: e => { if (e.key === 'Enter') add(); } });
      const add = () => { const v = input.value.trim(); if (!v) return; S().todos.push({ id: 'd' + uid(), text: v, done: false }); input.value = ''; change(); draw(); };
      const left = S().todos.filter(t => !t.done).length;
      return h('div', {},
        h('div', { class: 'lf-add-row' }, input, h('button', { type: 'button', class: 'btn-solid', onclick: add }, 'Add')),
        h('div', { class: 'st-list' }, S().todos.map(t => h('div', { class: 'st-todo' },
          h('button', { type: 'button', class: 'st-todo-toggle', 'aria-pressed': t.done ? 'true' : 'false', onclick: () => { t.done = !t.done; change(); draw(); } },
            h('span', { class: `st-box${t.done ? ' on' : ''}`, 'aria-hidden': 'true' }, t.done ? '✓' : ''),
            h('span', { class: t.done ? 'st-done-text' : '' }, t.text)),
          deleteButton('Delete to-do', () => { S().todos = S().todos.filter(x => x !== t); change(); draw(); })))),
        h('p', { class: 'tiny lf-muted' }, `${left} left`));
    }
    function draw() {
      const d = dateInfo();
      refs = { cycleBars: refs.cycleBars, yearRing: refs.yearRing, pomoTime: refs.pomoTime, pomoDot: refs.pomoDot };
      container.innerHTML = '';
      container.className = 'tpl tpl-life';
      container.dataset.template = 'life';
      container.dataset.theme = theme;
      const registry = {
        today: { title: 'Today', render: () => todayCard(d) },
        sound: { title: 'Ambient sound', render: soundCard },
        progress: { title: 'Time progress', render: () => progressCard(d) },
        pomodoro: { title: 'Pomodoro', render: pomodoroCard },
        priorities: { title: 'Problems & priorities', render: prioritiesSection },
        tasks: { title: 'Task overview', render: tasksSection },
        week: { title: 'This week', render: weekSection },
        habits: { title: 'Habits', render: habitsSection },
        stats: { title: 'Your stats', render: statsSection },
        notes: { title: 'Notes', render: notesWidget },
        todos: { title: 'To-dos', render: todosWidget },
      };
      const grid = FolioBoard.board({
        layout: S().layout, registry,
        onLayout: layout => { S().layout = layout; change(); draw(); },
      });
      container.append(
        h('div', { class: 'lf-page' },
          cover(d),
          h('div', { class: 'lf-body' },
            header(),
            h('div', { class: 'lf-layout' }, navGroups(), h('div', { class: 'lf-main' }, grid)))));
      updateLive();
    }

    draw();
    startTimer();

    return {
      destroy() {
        stopTimer();
        document.removeEventListener('visibilitychange', onVisibility);
        container.innerHTML = '';
      },
      get theme() { return theme; },
    };
  }

  window.FolioLife = { mount };
})();
