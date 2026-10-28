const test = require('node:test');
const assert = require('node:assert');
const T = require('../app/team-logic');

const team = {
  id: 't1', name: 'Design', headUid: 'head', memberIds: ['head', 'ana', 'raj'],
  members: { head: { name: 'Mukul', role: 'head' }, ana: { name: 'Ana', role: 'member' }, raj: { name: 'Raj', role: 'member' } },
};
const task = (id, o = {}) => ({ id, title: 'Task ' + id, notes: '', assigneeUid: 'ana', status: 'todo', priority: 'medium', dueDate: '', deleted: false, ...o });

test('invite codes use the 32-symbol alphabet and normalise what people type', () => {
  const code = T.inviteCodeFrom(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 255]));
  assert.ok(T.isInviteCode(code), code);
  assert.strictEqual(code.length, 8);
  assert.strictEqual(T.normalizeInviteCode(' abcd-2345 '), 'ABCD2345');
  assert.ok(!T.isInviteCode('ABCD234I')); // I is not in the alphabet
  assert.ok(!T.isInviteCode('ABC'));
  for (const c of T.INVITE_ALPHABET) assert.ok(!'IO01'.includes(c));
});

test('roles: head, member, outsider', () => {
  assert.ok(T.isHead(team, 'head') && !T.isHead(team, 'ana') && !T.isHead(team, 'nobody'));
  assert.ok(T.isMember(team, 'raj') && !T.isMember(team, 'nobody') && !T.isMember(null, 'x'));
});

test('normalizeTaskInput validates title, assignee, status, priority and due date', () => {
  assert.ok(T.normalizeTaskInput({ title: ' ', assigneeUid: 'ana' }, team).error);
  assert.ok(T.normalizeTaskInput({ title: 'x', assigneeUid: 'stranger' }, team).error);
  assert.ok(T.normalizeTaskInput({ title: 'x', assigneeUid: 'ana', dueDate: '31/12' }, team).error);
  assert.deepStrictEqual(T.normalizeTaskInput({ title: ' Ship it ', assigneeUid: 'ana', status: 'bogus', priority: 'high', dueDate: '2026-11-02' }, team),
    { title: 'Ship it', notes: '', assigneeUid: 'ana', status: 'todo', priority: 'high', dueDate: '2026-11-02' });
});

test('checkTaskPatch: head edits anything, assignee only the status, others nothing', () => {
  const t = task('1');
  assert.deepStrictEqual(T.checkTaskPatch(team, 'head', t, { assigneeUid: 'raj', priority: 'high' }), { patch: { assigneeUid: 'raj', priority: 'high' } });
  assert.ok(T.checkTaskPatch(team, 'head', t, { assigneeUid: 'stranger' }).error);
  assert.ok(T.checkTaskPatch(team, 'head', t, { createdBy: 'ana' }).error);
  assert.deepStrictEqual(T.checkTaskPatch(team, 'head', t, { deleted: 1 }), { patch: { deleted: true } });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'ana', t, { status: 'doing' }), { patch: { status: 'doing' } });
  assert.ok(T.checkTaskPatch(team, 'ana', t, { status: 'doing', title: 'Mine now' }).error);
  assert.ok(T.checkTaskPatch(team, 'ana', t, { title: 'x' }).error);
  assert.ok(T.checkTaskPatch(team, 'ana', t, { status: 'finished' }).error);
  assert.ok(T.checkTaskPatch(team, 'raj', t, { status: 'done' }).error, 'not their task');
  assert.ok(T.checkTaskPatch(team, 'stranger', t, { status: 'done' }).error);
  assert.ok(T.checkTaskPatch(team, 'head', t, {}).error);
});

test('a task whose person left the team can still be edited or deleted, but not handed to a stranger', () => {
  const orphan = task('9', { assigneeUid: 'gone' });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'head', orphan, { priority: 'high' }), { patch: { priority: 'high' } });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'head', orphan, { deleted: true }), { patch: { deleted: true } });
  assert.deepStrictEqual(T.checkTaskPatch(team, 'head', orphan, { assigneeUid: 'raj' }), { patch: { assigneeUid: 'raj' } });
  assert.ok(T.checkTaskPatch(team, 'head', orphan, { assigneeUid: 'stranger' }).error);
  assert.ok(T.normalizeTaskInput({ title: 'x', assigneeUid: 'gone' }, team).error, 'a new task still needs a current member');
  assert.strictEqual(T.nameOf(team, 'gone'), 'Former member');
});

test('only the head may add team events', () => {
  assert.ok(T.normalizeTeamEventInput({ title: 'Standup', startDate: '2026-11-02', allDay: true }, team, 'ana').error);
  assert.strictEqual(T.normalizeTeamEventInput({ title: 'Standup', startDate: '2026-11-02', allDay: true }, team, 'head').title, 'Standup');
});

test('filterTasks by person, status, text, hide done, overdue; deleted tasks never show', () => {
  const tasks = [task('1', { dueDate: '2026-10-01' }), task('2', { assigneeUid: 'raj', status: 'done', title: 'Budget' }), task('3', { deleted: true }), task('4', { notes: 'call the printer' })];
  assert.deepStrictEqual(T.filterTasks(tasks).map(t => t.id), ['1', '2', '4']);
  assert.deepStrictEqual(T.filterTasks(tasks, { assigneeUid: 'raj' }).map(t => t.id), ['2']);
  assert.deepStrictEqual(T.filterTasks(tasks, { hideDone: true }).map(t => t.id), ['1', '4']);
  assert.deepStrictEqual(T.filterTasks(tasks, { query: 'PRINTER' }).map(t => t.id), ['4']);
  assert.deepStrictEqual(T.filterTasks(tasks, { overdueOnly: true }, '2026-10-28').map(t => t.id), ['1']);
});

test('sortTasks: due date with empty last, priority, status; ties fall back to priority then title', () => {
  const tasks = [task('a', { dueDate: '2026-11-05' }), task('b'), task('c', { dueDate: '2026-11-01', priority: 'low' }), task('d', { dueDate: '2026-11-01', priority: 'high' })];
  assert.deepStrictEqual(T.sortTasks(tasks, 'due').map(t => t.id), ['d', 'c', 'a', 'b']);
  assert.deepStrictEqual(T.sortTasks(tasks, 'due', 'desc').map(t => t.id), ['a', 'd', 'c', 'b']); // empty still last
  assert.deepStrictEqual(T.sortTasks(tasks, 'priority').map(t => t.id)[0], 'd');
  const same = [task('late', { priority: 'high', dueDate: '2026-12-01' }), task('soon', { priority: 'high', dueDate: '2026-11-01' }), task('none', { priority: 'high' }), task('low', { priority: 'low', dueDate: '2026-10-01' })];
  assert.deepStrictEqual(T.sortTasks(same, 'priority').map(t => t.id), ['soon', 'late', 'none', 'low'], 'equal priority: soonest due first, undated last');
  const st = [task('x', { status: 'done' }), task('y', { status: 'todo' }), task('z', { status: 'doing' })];
  assert.deepStrictEqual(T.sortTasks(st, 'status').map(t => t.id), ['y', 'z', 'x']);
});

test('groupTasks by person lists every member (head first); by status keeps the order', () => {
  const tasks = [task('1', { assigneeUid: 'ana' }), task('2', { assigneeUid: 'ana', status: 'done' })];
  const g = T.groupTasks(tasks, 'assignee', team);
  assert.deepStrictEqual(g.map(x => x.label), ['Mukul', 'Ana', 'Raj']);
  assert.deepStrictEqual(g.map(x => x.tasks.length), [0, 2, 0]);
  assert.deepStrictEqual(T.groupTasks(tasks, 'status', team).map(x => [x.label, x.tasks.length]), [['To do', 1], ['Doing', 0], ['Done', 1]]);
  assert.strictEqual(T.groupTasks(tasks, 'none', team).length, 1);
});

test('calendar items: head sees all dated tasks, others only their own; team events keep their times', () => {
  const tasks = [task('1', { dueDate: '2026-11-02' }), task('2', { assigneeUid: 'raj', dueDate: '2026-11-03' }), task('3'), task('4', { dueDate: '2026-11-04', deleted: true })];
  const events = [{ id: 'e1', title: 'Standup', startDate: '2026-11-02', allDay: false, startTime: '10:00', endTime: '10:15' }, { id: 'e2', title: 'Old', startDate: '2026-11-02', deleted: true }];
  assert.deepStrictEqual(T.calendarItems(tasks, events, team, 'head').map(e => e.id), ['t:1', 't:2', 'e:e1']);
  assert.deepStrictEqual(T.calendarItems(tasks, events, team, 'ana').map(e => e.id), ['t:1', 'e:e1']);
  assert.strictEqual(T.calendarItems(tasks, events, team, 'raj').find(e => e.id === 'e:e1').startTime, '10:00');
});

test('server timestamps compare by their fraction as text and can be shifted back', () => {
  assert.ok(T.cmpTs('2026-10-28T10:00:00.5Z', '2026-10-28T10:00:00.45Z') > 0);
  assert.ok(T.cmpTs('2026-10-28T10:00:00.123456Z', '2026-10-28T10:00:00.123457Z') < 0);
  assert.ok(T.cmpTs('2026-10-28T10:00:01Z', '2026-10-28T10:00:00.999999999Z') > 0);
  assert.strictEqual(T.cmpTs('2026-10-28T10:00:00Z', '2026-10-28T10:00:00.000000Z'), 0);
  assert.strictEqual(T.maxTs(['2026-10-28T10:00:00Z', '2026-10-28T11:00:00.5Z', '2026-10-28T11:00:00.25Z']), '2026-10-28T11:00:00.5Z');
  assert.strictEqual(T.shiftTs('2026-10-28T10:02:00.5Z', -120), '2026-10-28T10:00:00.000Z');
});
