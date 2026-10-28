const test = require('node:test');
const assert = require('node:assert');
const H = require('../app/home-logic');
const M = require('../app/model');

const today = '2026-10-28';
const team = { id: 't1', name: 'Design', ownerUid: 'owen', memberIds: ['owen', 'lea', 'me', 'raj'], members: { owen: { name: 'Owen', role: 'admin' }, lea: { name: 'Lea', role: 'lead' }, me: { name: 'Me', role: 'member' }, raj: { name: 'Raj', role: 'member' } } };
const task = (id, o = {}) => ({ id, title: 'Task ' + id, notes: '', assigneeUid: 'me', status: 'todo', priority: 'medium', dueDate: '', mustDo: false, createdBy: 'owen', deleted: false, ...o });
const ids = section => section.items.map(i => i.key);
const get = (r, id) => r.sections.find(s => s.id === id);

test('each task is shown once, in the most urgent section it belongs to', () => {
  const tasks = [
    task('1', { mustDo: true, dueDate: '2026-10-20' }),          // must do (also overdue)
    task('2', { dueDate: '2026-10-27', priority: 'high' }),     // overdue (also important)
    task('3', { dueDate: today }),                               // due today
    task('4', { dueDate: '2026-10-29', priority: 'high' }),     // due tomorrow (also important)
    task('5', { dueDate: '2026-11-10', priority: 'high' }),     // important, later
    task('6', { priority: 'high' }),                             // important, no date
    task('7', { dueDate: '2026-11-10' }),                        // nothing to show
    task('8', { status: 'done', dueDate: today, mustDo: true }), // done: never shown
    task('9', { assigneeUid: 'raj', dueDate: today }),           // someone else's
    task('10', { deleted: true, dueDate: today }),               // deleted
  ];
  const r = H.build({ today, uid: 'me', team: { tasks, events: [], team, role: 'member' } });
  assert.deepStrictEqual(ids(get(r, 'mustdo')), ['t:1']);
  assert.deepStrictEqual(ids(get(r, 'overdue')), ['t:2']);
  assert.deepStrictEqual(ids(get(r, 'soon')), ['t:3', 't:4']);
  assert.deepStrictEqual(ids(get(r, 'important')), ['t:5', 't:6'], 'undated last');
  assert.ok(!get(r, 'attention'), 'a member has no team-wide section');
  assert.deepStrictEqual(r.summary, { mustDo: 1, overdue: 1, dueSoon: 2, important: 2, events: 0, attention: 0, needYou: 4 });
});

test('workspace task rows count too: only the Tasks databases, only open ones', () => {
  const db = M.makeDatabase('db', 'Tasks');
  const other = M.makeDatabase('db2', 'Ideas', [{ id: 'name', name: 'Name', type: 'text' }]);
  const pages = [db, other,
    M.makeRow('r1', db, 'Pay rent', { status: 'To do', priority: 'High', due: '2026-10-27' }),
    M.makeRow('r2', db, 'Call mom', { status: 'Doing', priority: 'Low', due: today }),
    M.makeRow('r3', db, 'Old thing', { status: 'Done', priority: 'High', due: '2026-10-01' }),
    M.makeRow('r4', db, 'Someday', { status: 'To do', priority: 'High' }),
    M.makeRow('r5', other, 'Idea', { name: 'x' }),
  ];
  const rows = H.rowsFromPages(pages);
  assert.deepStrictEqual(rows.map(r => r.id), ['r1', 'r2', 'r4']);
  const r = H.build({ today, uid: '', rows });
  assert.deepStrictEqual(ids(get(r, 'overdue')), ['r:r1']);
  assert.deepStrictEqual(ids(get(r, 'soon')), ['r:r2']);
  assert.deepStrictEqual(ids(get(r, 'important')), ['r:r4']);
  assert.strictEqual(get(r, 'overdue').items[0].sub, 'Tasks');
});

test('personal reminders: dated ones feed Overdue and Due soon, undated or later ones stay in My reminders, done ones vanish', () => {
  const reminders = [
    { id: 'a', text: 'Renew passport', date: '2026-10-20', done: false },
    { id: 'b', text: 'Buy a gift', date: '2026-10-29', done: false },
    { id: 'c', text: 'Learn guitar', date: '', done: false },
    { id: 'd', text: 'Dentist', date: '2026-12-01', done: false },
    { id: 'e', text: 'Finished already', date: today, done: true },
  ];
  const r = H.build({ today, uid: '', reminders });
  assert.deepStrictEqual(ids(get(r, 'overdue')), ['m:a']);
  assert.deepStrictEqual(ids(get(r, 'soon')), ['m:b']);
  assert.deepStrictEqual(ids(get(r, 'reminders')), ['m:d', 'm:c'], 'by date, undated last');
});

test('today’s calendar merges workspace, Google and team events, all-day first then by time', () => {
  const r = H.build({
    today, uid: 'me',
    localEvents: [{ id: 'l1', title: 'Gym', startDate: today, endDate: today, allDay: false, startTime: '07:00', endTime: '08:00' }, { id: 'l2', title: 'Tomorrow thing', startDate: '2026-10-29', allDay: true }],
    googleEvents: [{ googleId: 'g1', title: 'Dentist', startDate: today, endDate: today, allDay: false, startTime: '15:30', endTime: '16:00' }, { googleId: 'g2', title: 'Holiday', startDate: '2026-10-27', endDate: '2026-10-29', allDay: true }],
    team: { tasks: [], events: [{ id: 'e1', title: 'Standup', startDate: today, allDay: false, startTime: '09:30', endTime: '09:45' }, { id: 'e2', title: 'Cancelled', startDate: today, deleted: true }], team, role: 'member' },
  });
  const cal = get(r, 'calendar');
  assert.deepStrictEqual(cal.items.map(i => `${i.time} ${i.title} (${i.sub})`), ['All day Holiday (Google Calendar)', '07:00–08:00 Gym (Workspace)', '09:30–09:45 Standup (Team)', '15:30–16:00 Dentist (Google Calendar)']);
  assert.strictEqual(r.summary.events, 4);
});

test('admins and leads also see what is stuck for other people, capped, with the rest counted', () => {
  const many = Array.from({ length: 11 }, (_, i) => task('o' + i, { assigneeUid: 'raj', dueDate: '2026-10-1' + (i % 9), createdBy: 'lea' }));
  const tasks = [...many, task('m1', { assigneeUid: 'raj', mustDo: true }), task('fine', { assigneeUid: 'raj', dueDate: '2026-11-30' }), task('done', { assigneeUid: 'raj', dueDate: '2026-10-01', status: 'done' }), task('mine', { assigneeUid: 'lea', dueDate: '2026-10-01' })]; // the lead's own work is not 'other people'
  const lead = H.build({ today, uid: 'lea', team: { tasks, events: [], team, role: 'lead' } });
  const att = get(lead, 'attention');
  assert.strictEqual(att.items.length, 8);
  assert.strictEqual(att.more, 4, '12 stuck tasks, 8 shown');
  assert.strictEqual(att.items[0].sub, 'Raj · Design');
  assert.ok(!att.items.some(i => i.key === 'a:mine' || i.key === 'a:done' || i.key === 'a:fine'));
  const member = H.build({ today, uid: 'me', team: { tasks, events: [], team, role: 'member' } });
  assert.ok(!get(member, 'attention'));
});

test('pinned pages show up; pins whose page was deleted are skipped', () => {
  const pages = [{ id: 'p1', title: 'Launch plan' }, { id: 'p2', title: '', kind: 'database' }];
  const r = H.build({ today, uid: '', pins: ['p2', 'gone', 'p1'], pages });
  assert.deepStrictEqual(get(r, 'pinned').items.map(i => [i.title, i.sub]), [['Untitled', 'Database'], ['Launch plan', 'Page']]);
});

test('sections can be switched off, and an empty day says so', () => {
  const tasks = [task('1', { dueDate: '2026-10-20' })];
  const input = { today, uid: 'me', team: { tasks, events: [], team, role: 'member' } };
  assert.ok(get(H.build(input), 'overdue'));
  assert.ok(!get(H.build({ ...input, hidden: ['overdue'] }), 'overdue'));
  const calm = H.build({ today, uid: 'me' });
  assert.deepStrictEqual([calm.empty, calm.sections.length, calm.summary.needYou], [true, 0, 0]);
});

test('stored home data is cleaned: bad reminders, duplicate pins and unknown sections are dropped', () => {
  const clean = H.cleanHome({
    reminders: [{ id: 'a', text: '  Pay   rent ', date: '2026-10-30', done: 1 }, { id: 'b', text: '   ' }, { text: 'no id' }, null, { id: 'c', text: 'x', date: 'not a date' }],
    pins: ['p1', 'p1', 5, 'p2'], hidden: ['overdue', 'bogus'],
  });
  assert.deepStrictEqual(clean.reminders, [{ id: 'a', text: 'Pay rent', date: '2026-10-30', done: true, createdAt: 0 }, { id: 'c', text: 'x', date: '', done: false, createdAt: 0 }]);
  assert.deepStrictEqual([clean.pins, clean.hidden], [['p1', 'p2'], ['overdue']]);
  assert.deepStrictEqual(H.cleanHome(undefined), { reminders: [], pins: [], hidden: [] });
  assert.ok(H.normalizeReminder({ text: ' ' }).error);
  assert.ok(H.normalizeReminder({ text: 'x', date: '31/12' }).error);
  assert.deepStrictEqual(H.normalizeReminder({ text: ' Call  Priya ', date: '2026-11-02' }), { text: 'Call Priya', date: '2026-11-02' });
});
