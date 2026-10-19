// Template logic for Life OS and Study OS pages. Pure functions only (unit-tested); the UI lives in templates/.
// Data shapes follow CLAUDE_CODE_PROMPT.md §2. Sample data is the prototypes' constructor seed.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioTemplates = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const LIFE_STATUS = ['Not started', 'To-do', 'In progress', 'Done'];
  const LIFE_PRIORITY = ['Low', 'Normal', 'Urgent', 'Very urgent'];
  const DIFFICULTY = ['Easy', 'Normal', 'Hard', 'Very hard'];
  const STUDY_STATUS = ['Not started', 'In progress', 'Done'];
  const STUDY_PRIORITY = ['Low', 'Medium', 'High'];
  const HABIT_COLORS = ['#9B7BEA', '#E8A33D', '#C98A6A', '#D9534F', '#4E8FE8', '#D46A9A', '#2FB39A', '#7A8F3A'];
  const SCENE_PALETTES = ['grove', 'teal', 'neon', 'jade', 'dusk', 'harbor', 'rain', 'groveDay'];
  const AMBIENT = ['rain', 'forest', 'cafe', 'lofi'];
  const DAYS = 35;

  // Next value in a fixed list, wrapping around (status and priority chips).
  function cycle(list, value) {
    const i = list.indexOf(value);
    return list[(i + 1) % list.length];
  }

  // Life: a task is due today or tomorrow when its weekday (0 = Sunday) matches. No day means no date.
  function lifeDueBucket(task, todayDow) {
    if (task.day === null || task.day === undefined) return 'none';
    if (task.day === todayDow) return 'today';
    if (task.day === (todayDow + 1) % 7) return 'tomorrow';
    return 'other';
  }

  // Study: day 0 = Monday, so convert from JS getDay() (0 = Sunday).
  function studyDayFromJs(jsDay) {
    return jsDay === 0 ? 6 : jsDay - 1;
  }

  // Habit streak: consecutive ticked days ending today. If today is not ticked yet, count from yesterday.
  function habitStreak(days) {
    let i = days.length - 1;
    if (!days[i]) i -= 1;
    let n = 0;
    while (i >= 0 && days[i]) { n += 1; i -= 1; }
    return n;
  }

  // Habits completed per day across the 35-day window (feeds the stats chart).
  function habitTotals(habits) {
    const totals = new Array(DAYS).fill(0);
    for (const h of habits) for (let i = 0; i < DAYS; i++) if (h.days[i]) totals[i] += 1;
    return totals;
  }

  // Pomodoro: one step of the state machine. Work → break adds a cycle (capped at 4); break → work does not.
  function pomodoroAdvance(state, settings) {
    if (state.phase === 'work') {
      return { ...state, phase: 'break', left: settings.breakMin * 60, cycles: Math.min(4, state.cycles + 1), running: state.running };
    }
    return { ...state, phase: 'work', left: settings.workMin * 60 };
  }

  // One second of ticking. When the timer runs out, the phase advances and keeps running.
  function pomodoroTick(state, settings) {
    if (!state.running) return state;
    if (state.left > 1) return { ...state, left: state.left - 1 };
    return pomodoroAdvance(state, settings);
  }

  // Study mode pill timer (no cycles, stops at zero and counts a finished focus session).
  function studyTick(state) {
    if (!state.running) return state;
    if (state.left > 1) return { ...state, left: state.left - 1 };
    return { ...state, running: false, left: 0, sessions: state.mode === 'pomo' ? state.sessions + 1 : state.sessions };
  }

  // Deterministic pixel scene: the same (W, H, kind, palette, seed) always gives the same colours.
  // Returns a flat array of W*H colour strings (row-major). Canvas or CSS grid can draw it.
  const SCENE_PAL = {
    grove: { sky: ['#0E2A22', '#16402F', '#1F5A3D', '#2E7A4B'], canopy: ['#173F28', '#22573A', '#2F6E44', '#1C4B30'], light: '#9BD27A', ground: '#0C2016' },
    groveDay: { sky: ['#9FD3E6', '#B9E2D8', '#CFEBC8', '#E4F2C2'], canopy: ['#2F7A45', '#3E9152', '#58A85E', '#357F49'], light: '#C9EA8A', ground: '#24603A' },
    teal: { sky: ['#0E1A24', '#14283A', '#1E3A4E'], bld: '#0A1218', win: '#F2C46B', lit: 0.4, ground: '#1A2620' },
    neon: { sky: ['#1E0C12', '#3A141C', '#5A1E26'], bld: '#140A0D', win: '#FF6B5A', lit: 0.45, ground: '#2A1014' },
    jade: { sky: ['#0C2226', '#163A3A', '#245650'], bld: '#081614', win: '#7FE0C8', lit: 0.35, ground: '#10261F' },
    dusk: { sky: ['#1A1028', '#2E1E48', '#4E3070'], bld: '#100A1A', win: '#F59BD0', lit: 0.4, ground: '#1C1428' },
    harbor: { sky: ['#101C30', '#1E3256', '#33507E'], bld: '#0A111E', win: '#FFD27A', lit: 0.4, ground: '#142030' },
    rain: { sky: ['#141A22', '#222C38', '#33404E'], bld: '#0E1218', win: '#9ECBFF', lit: 0.3, ground: '#1A2028' },
  };
  function scene(W, H, kind, palName, seed) {
    const pal = SCENE_PAL[palName];
    if (!pal) throw new Error(`unknown palette ${palName}`);
    let r = seed;
    const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
    const heights = [];
    for (let c = 0; c < W; c++) heights.push(Math.floor(kind === 'forest' ? H * 0.35 + rnd() * H * 0.5 : H * 0.3 + rnd() * H * 0.6));
    const out = [];
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        let color = pal.sky[Math.min(pal.sky.length - 1, Math.floor((row / H) * pal.sky.length))];
        const hgt = heights[col], v = rnd();
        if (kind === 'forest') {
          if (row >= H - 1) color = pal.ground;
          else if (row >= H - hgt) color = v < 0.12 ? pal.light : pal.canopy[(col + row) % pal.canopy.length];
          else if (v < 0.015) color = pal.light;
        } else {
          if (row >= H - 1) color = pal.ground;
          else if (row >= H - hgt) color = v < pal.lit && col % 2 === 0 ? pal.win : pal.bld;
          else if (v < 0.02) color = '#FFFFFF66';
        }
        out.push(color);
      }
    }
    return out;
  }

  // Seeded samples, as the prototypes start with.
  function lifeSample() {
    const seedHabits = ['Journal', 'Morning focus', 'Move your body', 'Money check', 'Learn something', 'Make something'].map((name, h) => {
      const days = [];
      for (let i = 0; i < DAYS; i++) days.push(i < 34 && ((h * 7 + i * 5 + (i % 3) * h) % 10) < 7);
      return { id: `h${h}`, name, colorIndex: h, days };
    });
    const T = (id, name, status, priority, day, difficulty, project) => ({ id: `t${id}`, name, status, priority, day, difficulty, project });
    return {
      priorities: [
        'Cut down on miscommunication — write decisions down the same day.',
        'Spend 30 minutes daily learning something new for the ML project.',
        'Review each evening: keep what worked, fix one thing that didn’t.',
        'Log off by 9 pm and make something with your hands.',
      ],
      tasks: [
        T(1, 'Research financial APIs', 'Done', 'Normal', 0, 'Normal', 'Data pipeline'),
        T(2, 'Morning run (3 km)', 'Done', 'Low', 0, 'Easy', 'Rebuild routine'),
        T(3, 'Review ML course notes', 'Done', 'Normal', 1, 'Normal', 'Predictive model'),
        T(4, 'Debug ETL errors', 'To-do', 'Very urgent', 2, 'Hard', 'Data pipeline'),
        T(5, 'Book gym sessions', 'Done', 'Low', 3, 'Easy', 'Rebuild routine'),
        T(6, 'Start hyperparameter sweep', 'In progress', 'Urgent', 3, 'Hard', 'Model development'),
        T(7, 'Compare Budapest flights', 'In progress', 'Normal', 3, 'Normal', 'Travel'),
        T(8, 'Update LinkedIn profile', 'Done', 'Normal', 4, 'Normal', 'Career'),
        T(9, 'Automate data pull with cron', 'In progress', 'Urgent', 5, 'Very hard', 'Data pipeline'),
        T(10, 'Coffee with mentor', 'Done', 'Normal', 5, 'Normal', 'Career'),
        T(11, 'Ship model v0.3 to GitHub', 'In progress', 'Very urgent', 6, 'Very hard', 'Model development'),
        T(12, 'Journal entry #7 — “Chaos & clarity”', 'To-do', 'Low', 6, 'Easy', 'Second brain'),
        T(13, 'Renew passport photos', 'To-do', 'Normal', null, 'Easy', 'Admin'),
        T(14, 'Draft a post about the project', 'Not started', 'Normal', null, 'Normal', 'Writing'),
      ],
      habits: seedHabits,
      pomodoro: { workMin: 25, breakMin: 5 },
      ambientSound: 'rain',
    };
  }

  function studySample() {
    const C = (id, name, glyph, paletteIndex, done, total, nextExam) => ({ id, name, glyph, paletteIndex, done, total, nextExam });
    const T = (id, name, courseId, priority, status, day) => ({ id: `s${id}`, name, courseId, priority, status, day });
    return {
      courses: [
        C('cs', 'Computer Science', '>_', 0, 3, 4, 'Nov 3'),
        C('oop', 'Object-Oriented Prog.', '</>', 1, 2, 4, 'Nov 7'),
        C('alg', 'Algorithms', '∑', 2, 4, 4, 'Nov 12'),
        C('sw', 'Software Eng.', '{ }', 3, 1, 3, 'Nov 14'),
        C('ds', 'Data Structures', '⌗', 4, 2, 5, 'Nov 20'),
      ],
      tasks: [
        T(1, 'Assignment 1 — recursion', 'cs', 'High', 'Not started', 0), T(2, 'Assignment 2 — complexity', 'cs', 'Medium', 'Done', 0),
        T(3, 'Lab 3 — sorting benchmarks', 'alg', 'Medium', 'Done', 2), T(4, 'Assignment 4 — linked lists', 'ds', 'High', 'In progress', 3),
        T(5, 'Quiz 2 prep', 'ds', 'Low', 'Done', 3), T(6, 'Get practical review from TA', 'oop', 'High', 'Not started', 4),
        T(7, 'Graph traversal problem set', 'ds', 'High', 'In progress', 5), T(8, 'Write sprint retro', 'sw', 'Medium', 'Not started', 1),
        T(9, 'Finish desk setup', null, 'Medium', 'In progress', null), T(10, 'Plan birthday party', null, 'Low', 'Not started', null),
      ],
      timetable: [
        ['cs', 'cs', 'alg', 'sw', 'cs'], ['alg', 'cs', 'alg', 'sw', 'alg'], ['sw', 'cs', 'alg', 'sw', 'sw'], ['LUNCH', 'LUNCH', 'LUNCH', 'LUNCH', 'LUNCH'],
        ['ds', 'oop', 'ds', 'oop', 'ds'], ['ds', 'sw', 'ds', 'ds', 'ds'], ['oop', 'alg', 'ds', 'oop', 'oop'],
      ],
      wheel: [['Relationships', 7], ['Health', 6], ['Growth', 8], ['Money', 5], ['Career', 7], ['Fun', 4]].map(([area, value]) => ({ area, value })),
      todos: [
        { id: 'd1', text: 'Organize the desk', done: true }, { id: 'd2', text: 'Order protein supplements', done: false },
        { id: 'd3', text: 'Buy a hyperfocus book', done: false }, { id: 'd4', text: 'Pick up highlighters', done: true },
        { id: 'd5', text: 'Book a study room for Friday', done: false },
      ],
      reminders: [
        { id: 'r1', date: 'Oct 24', text: 'Meetup with friends after midterms' }, { id: 'r2', date: 'Oct 26', text: 'Library book due — Algorithms' },
        { id: 'r3', date: 'Oct 31', text: 'Jay’s birthday' }, { id: 'r4', date: 'Nov 2', text: 'Scholarship form deadline' },
      ],
    };
  }

  // Empty pages: the "Start empty" option. Timetable keeps its shape with no courses.
  function lifeEmpty() {
    return { priorities: [], tasks: [], habits: [], pomodoro: { workMin: 25, breakMin: 5 }, ambientSound: 'rain' };
  }
  function studyEmpty() {
    return {
      courses: [], tasks: [], timetable: Array.from({ length: 7 }, () => ['', '', '', '', '']),
      wheel: ['Relationships', 'Health', 'Growth', 'Money', 'Career', 'Fun'].map(area => ({ area, value: 5 })),
      todos: [], reminders: [],
    };
  }

  // A new template page as stored in the workspace file. Template pages keep their state under `state`.
  function makeTemplatePage(id, template, { theme = null, sample = true, now = Date.now() } = {}) {
    const life = template === 'life';
    const ts = new Date(now).toISOString();
    const state = life ? (sample ? lifeSample() : lifeEmpty()) : (sample ? studySample() : studyEmpty());
    if (!life) state.sessionsToday = { date: ts.slice(0, 10), count: sample ? 3 : 0 };
    return {
      id, kind: 'template', template, parentId: null, blocks: [],
      title: life ? 'Life OS' : 'Study OS',
      subtitle: life ? 'Plan the day, protect your focus, keep the streaks alive.' : 'Courses, deadlines, focus sessions and goals — one page per semester.',
      theme: theme === 'dark' || theme === 'light' ? theme : null,
      createdAt: ts, updatedAt: ts, state,
    };
  }
  // Keeps arrays and enums sane so a damaged file cannot crash a template page.
  function sanitizeLife(s) {
    const e = lifeEmpty();
    const src = s && typeof s === 'object' ? s : {};
    return {
      priorities: Array.isArray(src.priorities) ? src.priorities.filter(x => typeof x === 'string') : e.priorities,
      tasks: (Array.isArray(src.tasks) ? src.tasks : []).filter(t => t && typeof t.id === 'string').map(t => ({
        id: t.id, name: String(t.name || ''), status: LIFE_STATUS.includes(t.status) ? t.status : 'Not started',
        priority: LIFE_PRIORITY.includes(t.priority) ? t.priority : 'Normal',
        day: Number.isInteger(t.day) && t.day >= 0 && t.day <= 6 ? t.day : null,
        difficulty: DIFFICULTY.includes(t.difficulty) ? t.difficulty : 'Normal', project: String(t.project || ''),
      })),
      habits: (Array.isArray(src.habits) ? src.habits : []).filter(h => h && typeof h.id === 'string').map(h => ({
        id: h.id, name: String(h.name || ''), colorIndex: Number.isInteger(h.colorIndex) ? h.colorIndex % HABIT_COLORS.length : 0,
        days: Array.from({ length: DAYS }, (_, i) => Boolean(Array.isArray(h.days) && h.days[i])),
      })),
      pomodoro: {
        workMin: clampInt(src.pomodoro && src.pomodoro.workMin, 5, 90, 25),
        breakMin: clampInt(src.pomodoro && src.pomodoro.breakMin, 1, 30, 5),
      },
      ambientSound: AMBIENT.includes(src.ambientSound) ? src.ambientSound : 'rain',
    };
  }

  function sanitizeStudy(s) {
    const e = studyEmpty();
    const src = s && typeof s === 'object' ? s : {};
    const timetable = Array.isArray(src.timetable) && src.timetable.length === 7 ? src.timetable.map(row => Array.from({ length: 5 }, (_, i) => (Array.isArray(row) && typeof row[i] === 'string' ? row[i] : ''))) : e.timetable;
    return {
      courses: (Array.isArray(src.courses) ? src.courses : []).filter(c => c && typeof c.id === 'string').map((c, i) => ({
        id: c.id, name: String(c.name || ''), glyph: String(c.glyph || ''), paletteIndex: Number.isInteger(c.paletteIndex) ? c.paletteIndex : i,
        done: clampInt(c.done, 0, 999, 0), total: clampInt(c.total, 0, 999, 0), nextExam: String(c.nextExam || ''),
      })),
      tasks: (Array.isArray(src.tasks) ? src.tasks : []).filter(t => t && typeof t.id === 'string').map(t => ({
        id: t.id, name: String(t.name || ''), courseId: typeof t.courseId === 'string' ? t.courseId : null,
        priority: STUDY_PRIORITY.includes(t.priority) ? t.priority : 'Medium',
        status: STUDY_STATUS.includes(t.status) ? t.status : 'Not started',
        day: Number.isInteger(t.day) && t.day >= 0 && t.day <= 6 ? t.day : null,
      })),
      timetable,
      wheel: Array.isArray(src.wheel) && src.wheel.length === 6 ? src.wheel.map(w => ({ area: String(w.area || ''), value: clampInt(w.value, 1, 10, 5) })) : e.wheel,
      todos: (Array.isArray(src.todos) ? src.todos : []).filter(t => t && typeof t.id === 'string').map(t => ({ id: t.id, text: String(t.text || ''), done: Boolean(t.done) })),
      reminders: (Array.isArray(src.reminders) ? src.reminders : []).filter(r => r && typeof r.id === 'string').map(r => ({ id: r.id, date: String(r.date || ''), text: String(r.text || '') })),
      sessionsToday: src.sessionsToday && typeof src.sessionsToday.date === 'string' ? { date: src.sessionsToday.date, count: clampInt(src.sessionsToday.count, 0, 999, 0) } : { date: '', count: 0 },
    };
  }

  function clampInt(v, lo, hi, fallback) {
    const n = Number.isFinite(v) ? Math.round(v) : fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  return {
    LIFE_STATUS, LIFE_PRIORITY, DIFFICULTY, STUDY_STATUS, STUDY_PRIORITY, HABIT_COLORS, SCENE_PALETTES, AMBIENT, DAYS,
    cycle, lifeDueBucket, studyDayFromJs, habitStreak, habitTotals,
    pomodoroAdvance, pomodoroTick, studyTick, scene,
    lifeSample, studySample, lifeEmpty, studyEmpty, sanitizeLife, sanitizeStudy, makeTemplatePage,
  };
});
