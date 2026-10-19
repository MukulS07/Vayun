const test = require('node:test');
const assert = require('node:assert');
const L = require('../app/template-logic');

test('due-date derivation: today, tomorrow (wrapping Saturday to Sunday), none, other', () => {
  const t = day => ({ day });
  assert.strictEqual(L.lifeDueBucket(t(3), 3), 'today');
  assert.strictEqual(L.lifeDueBucket(t(4), 3), 'tomorrow');
  assert.strictEqual(L.lifeDueBucket(t(0), 6), 'tomorrow', 'Saturday rolls to Sunday');
  assert.strictEqual(L.lifeDueBucket(t(null), 3), 'none');
  assert.strictEqual(L.lifeDueBucket(t(1), 3), 'other');
  assert.strictEqual(L.studyDayFromJs(0), 6, 'Sunday is day 6 in the Monday-first study week');
  assert.strictEqual(L.studyDayFromJs(1), 0, 'Monday is day 0');
});

test('status and priority cycle and wrap', () => {
  assert.strictEqual(L.cycle(L.LIFE_STATUS, 'Not started'), 'To-do');
  assert.strictEqual(L.cycle(L.LIFE_STATUS, 'Done'), 'Not started', 'Done wraps to the start');
  assert.strictEqual(L.cycle(L.LIFE_PRIORITY, 'Very urgent'), 'Low');
  assert.strictEqual(L.cycle(L.STUDY_PRIORITY, 'High'), 'Low');
  assert.strictEqual(L.cycle(L.STUDY_STATUS, 'In progress'), 'Done');
});

test('habit streak counts back from today; an unticked today counts from yesterday', () => {
  const days = (n, ticksAtEnd) => Array.from({ length: 35 }, (_, i) => i >= 35 - ticksAtEnd && i < 35 - ticksAtEnd + n ? true : false);
  const ticked = Array(35).fill(false);
  for (let i = 30; i <= 34; i++) ticked[i] = true;
  assert.strictEqual(L.habitStreak(ticked), 5);
  const broken = [...ticked]; broken[32] = false;
  assert.strictEqual(L.habitStreak(broken), 2, 'streak stops at the first unticked day');
  const yesterday = Array(35).fill(false); yesterday[33] = true; yesterday[32] = true;
  assert.strictEqual(L.habitStreak(yesterday), 2, 'today not ticked yet still shows yesterday streak');
  assert.strictEqual(L.habitStreak(Array(35).fill(false)), 0);
  assert.ok(days);
});

test('habit totals per day feed the stats chart', () => {
  const habits = [{ days: Array(35).fill(true) }, { days: Array(35).fill(false) }];
  const totals = L.habitTotals(habits);
  assert.strictEqual(totals.length, 35);
  assert.ok(totals.every(n => n === 1));
});

test('pomodoro: work ends into break and adds a cycle (capped at 4); break returns to work', () => {
  const settings = { workMin: 25, breakMin: 5 };
  const s0 = { phase: 'work', left: 1, running: true, cycles: 0 };
  const s1 = L.pomodoroTick(s0, settings);
  assert.strictEqual(s1.phase, 'break');
  assert.strictEqual(s1.left, 300);
  assert.strictEqual(s1.cycles, 1);
  assert.strictEqual(s1.running, true, 'keeps running into the break');
  const s2 = L.pomodoroAdvance({ phase: 'work', left: 1, running: true, cycles: 4 }, settings);
  assert.strictEqual(s2.phase, 'break');
  assert.strictEqual(s2.cycles, 4, 'cycles cap at 4');
  const back = L.pomodoroAdvance({ ...s1, phase: 'break', left: 0, cycles: 4 }, settings);
  assert.strictEqual(back.phase, 'work');
  assert.strictEqual(back.left, 1500);
  assert.strictEqual(back.cycles, 4, 'break to work does not add a cycle');
  assert.strictEqual(L.pomodoroTick({ phase: 'work', left: 10, running: false, cycles: 0 }, settings).left, 10, 'paused timer does not move');
});

test('pomodoro cycles cap at 4 across many work sessions', () => {
  const settings = { workMin: 1, breakMin: 1 };
  let s = { phase: 'work', left: 1, running: true, cycles: 0 };
  for (let i = 0; i < 20; i++) s = L.pomodoroTick(s.phase === 'work' ? { ...s, left: 1 } : { ...s, left: 1 }, settings);
  assert.ok(s.cycles <= 4);
});

test('study timer counts a finished focus session once and stops', () => {
  const s = L.studyTick({ mode: 'pomo', left: 1, running: true, sessions: 3 });
  assert.deepStrictEqual([s.left, s.running, s.sessions], [0, false, 4]);
  const brk = L.studyTick({ mode: 'short', left: 1, running: true, sessions: 3 });
  assert.strictEqual(brk.sessions, 3, 'breaks do not count as sessions');
});

test('pixel scene is deterministic for the same seed and differs for another', () => {
  const a = L.scene(72, 14, 'forest', 'grove', 42);
  const b = L.scene(72, 14, 'forest', 'grove', 42);
  const c = L.scene(72, 14, 'forest', 'grove', 43);
  assert.strictEqual(a.length, 72 * 14);
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
  assert.throws(() => L.scene(4, 4, 'city', 'nope', 1));
});

test('sample data has the prototype shapes', () => {
  const life = L.lifeSample();
  assert.strictEqual(life.habits.length, 6);
  assert.ok(life.habits.every(h => h.days.length === 35));
  assert.strictEqual(life.tasks.length, 14);
  const study = L.studySample();
  assert.strictEqual(study.timetable.length, 7);
  assert.ok(study.timetable.every(r => r.length === 5));
  assert.strictEqual(study.wheel.length, 6);
});

test('sanitizers repair damaged data instead of crashing', () => {
  const life = L.sanitizeLife({ tasks: [{ id: 'x', name: 'a', status: 'Nope', priority: 'Urgent', day: 9 }, null, 5], habits: [{ id: 'h', days: [true] }], pomodoro: { workMin: 9999 } });
  assert.strictEqual(life.tasks.length, 1);
  assert.strictEqual(life.tasks[0].status, 'Not started');
  assert.strictEqual(life.tasks[0].day, null);
  assert.strictEqual(life.habits[0].days.length, 35);
  assert.strictEqual(life.pomodoro.workMin, 90);
  const study = L.sanitizeStudy({ timetable: [[1]], wheel: [{ area: 'x', value: 99 }] });
  assert.strictEqual(study.timetable.length, 7, 'bad timetable falls back to the empty grid');
  assert.strictEqual(L.sanitizeLife(null).tasks.length, 0);
});

test('new template page: correct kind, seeded state, Start empty option', () => {
  const p = L.makeTemplatePage('p1', 'study', { theme: 'light', now: 0 });
  assert.strictEqual(p.kind, 'template');
  assert.strictEqual(p.template, 'study');
  assert.strictEqual(p.theme, 'light');
  assert.strictEqual(p.state.courses.length, 5);
  assert.strictEqual(p.state.sessionsToday.count, 3);
  assert.ok(Array.isArray(p.blocks), 'blocks required by the workspace file');
  const empty = L.makeTemplatePage('p2', 'life', { sample: false, now: 0 });
  assert.strictEqual(empty.state.tasks.length, 0);
  assert.strictEqual(empty.theme, null, 'no theme means the page follows the fallback order');
});

test('sanitizeStudy keeps sessionsToday across reloads', () => {
  const s = L.sanitizeStudy({ sessionsToday: { date: '2026-10-19', count: 4 } });
  assert.deepStrictEqual(s.sessionsToday, { date: '2026-10-19', count: 4 });
});
